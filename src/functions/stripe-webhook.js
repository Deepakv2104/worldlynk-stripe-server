const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { db, admin } = require('./firebase');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  const sig = event.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;

  try {
    // Verify the webhook signature
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, endpointSecret);
    console.log('Webhook signature verified successfully');
  } catch (err) {
    console.error('Error verifying webhook signature:', err.message);
    return {
      statusCode: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Invalid signature' }),
    };
  }

  console.log('Received Stripe event:', stripeEvent.type);

  try {
    switch (stripeEvent.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = stripeEvent.data.object;
        console.log(`PaymentIntent for ${paymentIntent.amount} was successful!`);

        const paymentAmount = paymentIntent.amount / 100;

        try {
          const sessions = await stripe.checkout.sessions.list({
            payment_intent: paymentIntent.id,
            limit: 1,
          });

          if (sessions.data.length > 0) {
            const session = sessions.data[0];
            console.log('Associated session found:', session.id);

            // Parse the user data from the session metadata
            let userData = {};
            if (session.metadata && session.metadata.user) {
              userData = JSON.parse(session.metadata.user);
            }

            let tickets = [];
            if (session.metadata && session.metadata.tickets) {
              tickets = JSON.parse(session.metadata.tickets);
            }

            await db.collection('payments').doc(paymentIntent.id).set({
              id: paymentIntent.id,
              amount: paymentAmount,
              currency: paymentIntent.currency,
              status: paymentIntent.status,
              created: admin.firestore.Timestamp.fromDate(new Date(paymentIntent.created * 1000)),
              tickets: tickets,
              user: userData,
            });

            console.log(`Payment data saved to Firestore with ID: ${paymentIntent.id}`);
          } else {
            console.log('No associated session found for this payment intent');
          }
        } catch (error) {
          console.error('Error processing payment intent:', error);
        }
        break;
      }
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;

        const sessionAmountTotal = session.amount_total / 100;

        // Parse the user data from the session metadata
        let userData = {};
        if (session.metadata && session.metadata.user) {
          userData = JSON.parse(session.metadata.user);
        }

        let tickets = [];
        if (session.metadata && session.metadata.tickets) {
          tickets = JSON.parse(session.metadata.tickets);
        }

        await db.collection('checkouts').doc(session.id).set({
          id: session.id,
          amount_total: sessionAmountTotal,
          currency: session.currency,
          status: session.payment_status,
          customer_email: session.customer_email,
          customer_id: userData.uid || '',
          customer_name: userData.name || '',
          created: admin.firestore.Timestamp.fromDate(new Date(session.created * 1000)),
          tickets: tickets,
          user: userData,
        });

        console.log(`Checkout session data saved to Firestore with ID: ${session.id}`);
        break;
      }

      // Add more cases for different event types as needed
      default:
        console.warn(`Unhandled event type: ${stripeEvent.type}`);
    }
  } catch (error) {
    console.error('Error handling Stripe event:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Internal Server Error', message: error.message }),
    };
  }

  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ received: true }),
  };
};
