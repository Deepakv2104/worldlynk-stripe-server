const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { db, admin } = require('./firebase');
const QRCode = require('qrcode');

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
        await handlePaymentIntentSucceeded(stripeEvent.data.object);
        break;
      }
      case 'checkout.session.completed': {
        await handleCheckoutSessionCompleted(stripeEvent.data.object);
        break;
      }
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

async function handlePaymentIntentSucceeded(paymentIntent) {
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

      const { userData, tickets, organizerDetails } = parseSessionMetadata(session.metadata);

      console.log('Parsed Organizer Details:', organizerDetails); // Log the parsed organizer details to check if they are correct

      const qrCodeUrl = await generateQRCodeUrl({
        id: paymentIntent.id,
        user: userData.uid,
        tickets,
      });

      const paymentData = {
        id: paymentIntent.id,
        amount: paymentAmount,
        currency: paymentIntent.currency,
        status: paymentIntent.status,
        created: admin.firestore.Timestamp.fromDate(new Date(paymentIntent.created * 1000)),
        tickets,
        user: userData,
        qrCodeUrl,
        verified: false,
        organizerId: organizerDetails.organizerId || '',
        organizerName: organizerDetails.organizer || '',
      };

      console.log('Payment Data to be saved:', paymentData); // Log the data before saving

      await saveToFirestore('payments', paymentIntent.id, paymentData);
    } else {
      console.log('No associated session found for this payment intent');
    }
  } catch (error) {
    console.error('Error processing payment intent:', error);
  }
}

async function handleCheckoutSessionCompleted(session) {
  console.log('Checkout session completed:', session.id);

  const sessionAmountTotal = session.amount_total / 100;

  try {
    // Parse session metadata
    const { userData, tickets, organizerDetails } = parseSessionMetadata(session.metadata);

    // Log parsed organizer details
    console.log('Parsed Organizer Details:', organizerDetails);

    // Generate QR Code URL
    const qrCodeUrl = await generateQRCodeUrl({
      id: session.id,
      user: userData.uid,
      tickets,
    });

    // Prepare the data to be saved to Firestore
    const checkoutData = {
      id: session.id,
      amount_total: sessionAmountTotal,
      currency: session.currency,
      status: session.payment_status,
      customer_email: session.customer_email,
      customer_id: userData.uid || '',
      customer_name: userData.name || '',
      created: admin.firestore.Timestamp.fromDate(new Date(session.created * 1000)),
      tickets,
      user: userData,
      qrCodeUrl,
      verified: false,
      organizerId: organizerDetails.organizerId || '',
      organizerName: organizerDetails.organizer || '',
    };

    // Log the data to be saved
    console.log('Checkout Data to be saved:', checkoutData);

    // Save the data to the 'checkouts' collection
    await saveToFirestore('checkouts', session.id, checkoutData);
  } catch (error) {
    console.error('Error processing checkout session:', error);
  }
}


function parseSessionMetadata(metadata) {
  let userData = {};
  let tickets = [];
  let organizerDetails = {};

  try {
    if (metadata) {
      if (metadata.user) {
        userData = JSON.parse(metadata.user);
      }
      if (metadata.tickets) {
        tickets = JSON.parse(metadata.tickets);
      }
      if (metadata.organizer) {
        organizerDetails = JSON.parse(metadata.organizer);
      }
    }
  } catch (error) {
    console.error('Error parsing session metadata:', error);
  }

  return { userData, tickets, organizerDetails };
}

async function generateQRCodeUrl(qrData) {
  let qrCodeUrl = null;

  try {
    qrCodeUrl = await QRCode.toDataURL(JSON.stringify(qrData));
    console.log('QR Code URL generated successfully');
  } catch (error) {
    console.error('Error generating QR code:', error);
  }

  return qrCodeUrl;
}

async function saveToFirestore(collectionName, docId, data) {
  try {
    await db.collection(collectionName).doc(docId).set(data);
    console.log(`Data saved to Firestore in ${collectionName} with ID: ${docId}`);

    // Verify data was saved correctly
    const savedDoc = await db.collection(collectionName).doc(docId).get();
    if (savedDoc.exists) {
      console.log(`Saved data in ${collectionName}:`, savedDoc.data());
    } else {
      console.error(`Data in ${collectionName} not saved correctly`);
    }
  } catch (error) {
    console.error(`Error saving data to Firestore in ${collectionName}:`, error);
  }
}


