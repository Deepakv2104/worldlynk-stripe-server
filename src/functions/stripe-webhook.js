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

  // Handle the event
  try {
    switch (stripeEvent.type) {
      case 'payment_intent.succeeded':
        {
          const paymentIntent = stripeEvent.data.object;
          console.log(`PaymentIntent for ${paymentIntent.amount} was successful!`);
      
          // Convert amount to major currency unit
          const paymentAmount = paymentIntent.amount / 100;
      
          try {
            // Attempt to find the associated checkout session
            const sessions = await stripe.checkout.sessions.list({
              payment_intent: paymentIntent.id,
              limit: 1,
            });
      
            let userData = {};
            let tickets = [];
      
            if (sessions.data.length > 0) {
              const session = sessions.data[0];
              console.log('Associated session found:', session.id);
      
              // Extract ticket data and user data from the session
              if (session.metadata && session.metadata.tickets) {
                tickets = JSON.parse(session.metadata.tickets);
              }
              userData = {
                name: session.metadata ? session.metadata.name : '',
                email: session.customer_email,
              };
            } else {
              console.log('No associated session found for this payment intent');
            }
      
            // Save to Firestore
            const paymentDoc = await db.collection('payments').doc(paymentIntent.id).set({
              id: paymentIntent.id,
              amount: paymentAmount,
              currency: paymentIntent.currency,
              status: paymentIntent.status,
              created: admin.firestore.Timestamp.fromDate(new Date(paymentIntent.created * 1000)),
              tickets: tickets,
              user: userData,
            });
      
            console.log(`Payment data saved to Firestore with ID: ${paymentIntent.id}`);
          } catch (error) {
            console.error('Error processing payment intent:', error);
          }
        }
        break;
        case 'checkout.session.completed':
          {
            const session = stripeEvent.data.object;
            // console.log('Checkout session completed:', session);
        
            // Convert amount to major currency unit
            const sessionAmountTotal = session.amount_total / 100;
        
            // Extract ticket data
            let tickets = [];
            if (session.metadata && session.metadata.tickets) {
              tickets = JSON.parse(session.metadata.tickets);
            }
        
            // Save to Firestore
            await db.collection('checkouts').doc(session.id).set({
              id: session.id,
              amount_total: sessionAmountTotal,
              currency: session.currency,
              status: session.payment_status,
              customer_email: session.customer_email,
              customer_id:session.metadata ? session.metadata.user_id: '',
              customer_name: session.metadata ? session.metadata.name : '',
              created: admin.firestore.Timestamp.fromDate(new Date(session.created * 1000)),
              tickets: tickets,
            });
        
            console.log(`Checkout session data saved to Firestore with ID: ${session.id}`);
          }
          break;
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
