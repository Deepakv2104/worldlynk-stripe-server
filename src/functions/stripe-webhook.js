const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { db, admin } = require('./firebase');
const QRCode = require('qrcode');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const stripeEvent = verifyStripeWebhook(event);
    await processStripeEvent(stripeEvent);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ received: true }) };
  } catch (error) {
    console.error('Error processing webhook:', error);
    return { 
      statusCode: error.statusCode || 500, 
      headers: corsHeaders, 
      body: JSON.stringify({ error: error.message || 'Internal Server Error' })
    };
  }
};

function verifyStripeWebhook(event) {
  const sig = event.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  try {
    return stripe.webhooks.constructEvent(event.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    throw new Error(`Webhook signature verification failed: ${err.message}`);
  }
}

async function processStripeEvent(stripeEvent) {
  try {
    switch (stripeEvent.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(stripeEvent.data.object);
        break;
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(stripeEvent.data.object);
        break;
      default:
        console.warn(`Unhandled event type: ${stripeEvent.type}`);
    }
  } catch (error) {
    console.error(`Error processing Stripe event (${stripeEvent.type}):`, error);
    throw error; // Propagate the error to be caught by the outer try/catch
  }
}

async function handlePaymentIntentSucceeded(paymentIntent) {
  console.log(`PaymentIntent for ${paymentIntent.amount} was successful!`);

  const paymentAmount = paymentIntent.amount / 100;

  try {
    const sessions = await stripe.checkout.sessions.list({
      payment_intent: paymentIntent.id,
      limit: 1,
    });

    if (sessions.data.length === 0) {
      console.log('No associated session found for this payment intent');
      return;
    }

    const session = sessions.data[0];
    console.log('Associated session found:', session.id);

    const { userData, tickets, organizerDetails } = parseSessionMetadata(session.metadata);

    if (!userData || !tickets.length) {
      throw new Error('Missing user data or tickets information in session metadata.');
    }

    console.log('Parsed Organizer Details:', organizerDetails);

    const qrCodeUrl = await generateQRCodeUrl({
      id: paymentIntent.id,
      user: userData.uid,
      tickets,
    });

    const charge = paymentIntent.charges?.data?.[0];
    const paymentMethodDetails = charge?.payment_method_details?.card;

    const paymentData = {
      orderId: paymentIntent.id,  
      amount: paymentAmount,
      currency: paymentIntent.currency,
      status: paymentIntent.status,
      created: admin.firestore.Timestamp.fromDate(new Date(paymentIntent.created * 1000)),
      tickets: tickets.map(ticket => ({
        ...ticket,
        id: generateUniqueTicketId(),
        status: 'valid'
      })),
      user: userData,
      qrCodeUrl,
      verified: false,
      organizerId: organizerDetails.organizerId || '',
      organizerName: organizerDetails.organizer || '',
      purchaseDate: admin.firestore.Timestamp.now(),
      totalAmountPaid: paymentAmount,
      refund: {
        status: 'not_refunded',
        amount: null,
        date: null
      },
      paymentMethod: {
        last4: paymentMethodDetails?.last4 || '',
        brand: paymentMethodDetails?.brand || ''
      },
      termsVersion: 'v1.0',
      eventDetails: {
        eventId: userData.eventId,
        eventTitle: userData.eventTitle,
        eventLocation: userData.eventLocation,
        eventDate: userData.eventDate,
        eventTime: userData.eventTime
      }
    };

    console.log('Payment Data to be saved:', paymentData);

    await saveToFirestore('payments', paymentIntent.id, paymentData);
  } catch (error) {
    console.error('Error processing payment intent:', error);
    throw error;
  }
}

async function handleCheckoutSessionCompleted(session) {
  console.log('Checkout session completed:', session.id);

  const sessionAmountTotal = session.amount_total / 100;

  try {
    const { userData, tickets, organizerDetails } = parseSessionMetadata(session.metadata);

    if (!userData || !tickets.length) {
      throw new Error('Missing user data or tickets information in session metadata.');
    }

    console.log('Parsed Organizer Details:', organizerDetails);

    const qrCodeUrl = await generateQRCodeUrl({
      id: session.id,
      user: userData.uid,
      tickets,
    });

    const checkoutData = {
      sessionId: session.id,
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

    console.log('Checkout Data to be saved:', checkoutData);

    await saveToFirestore('checkouts', session.id, checkoutData);
  } catch (error) {
    console.error('Error processing checkout session:', error);
    throw error;
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
  try {
    const qrCodeUrl = await QRCode.toDataURL(JSON.stringify(qrData));
    console.log('QR Code URL generated successfully');
    return qrCodeUrl;
  } catch (error) {
    console.error('Error generating QR code:', error);
    throw error;
  }
}

function generateUniqueTicketId() {
  return '_' + Math.random().toString(36).substr(2, 9);
}

async function saveToFirestore(collectionName, docId, data) {
  try {
    await db.runTransaction(async (transaction) => {
      const docRef = db.collection(collectionName).doc(docId);
      transaction.set(docRef, data);
    });
    console.log(`Data saved to Firestore in ${collectionName} with ID: ${docId}`);
  } catch (error) {
    console.error(`Error saving data to Firestore in ${collectionName}:`, error);
    throw error;
  }
}
