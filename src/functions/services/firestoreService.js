const { stripe } = require('./stripeService');
const { db, admin } = require('../config/firebase');
const { generateQRCodeUrl } = require('./qrService');
const { parseSessionMetadata } = require('../utils/parseMetadata');
const transactionQueue = require('./transactionQueue'); 

// Main function to process Stripe events
async function processStripeEvent(stripeEvent) {
  switch (stripeEvent.type) {
    case 'payment_intent.succeeded':
      await handlePaymentIntentSucceeded(stripeEvent.data.object);
      break;
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(stripeEvent.data.object);
      break;
    case 'payment_intent.payment_failed':
      await handlePaymentFailed(stripeEvent.data.object);
      break;
    case 'checkout.session.async_payment_failed':
      await handleAsyncPaymentFailed(stripeEvent.data.object);
      break;
    default:
      console.warn(`Unhandled event type: ${stripeEvent.type}`);
  }
}

// Handler for `payment_intent.succeeded` event
async function handlePaymentIntentSucceeded(paymentIntent) {
  console.log(`Handling payment_intent.succeeded for PaymentIntent ID: ${paymentIntent.id}`);

  try {
      // Fetch associated checkout session
      console.log(`Fetching checkout session for PaymentIntent ID: ${paymentIntent.id}`);
      const sessions = await stripe.checkout.sessions.list({
          payment_intent: paymentIntent.id,
          limit: 1,
      });

      if (sessions.data.length === 0) {
          console.error(`No session found for PaymentIntent ID: ${paymentIntent.id}`);
          throw new Error(`No session found for PaymentIntent ID: ${paymentIntent.id}`);
      }

      const session = sessions.data[0];
      console.log(`Session found: ${session.id} for PaymentIntent ID: ${paymentIntent.id}`);

      const { userData, tickets, organizerDetails } = parseSessionMetadata(session.metadata);
      console.log('Parsed session metadata:', { userData, tickets, organizerDetails });

      // Generate QR code URL
      console.log(`Generating QR code URL for PaymentIntent ID: ${paymentIntent.id}`);
      const qrCodeUrl = await generateQRCodeUrl({
          id: paymentIntent.id,
          user: userData.uid,
          tickets,
      });
      console.log('QR code URL generated:', qrCodeUrl);

      const charge = paymentIntent.charges?.data?.[0];
      const paymentMethodDetails = charge?.payment_method_details?.card;

      // Prepare transaction data to be saved
      const transactionData = {
          transactionId: paymentIntent.id,
          sessionId: session.id,
          userId: userData.uid,

          payment: {
              amount: paymentIntent.amount / 100,
              currency: paymentIntent.currency,
              status: paymentIntent.status,
              created: admin.firestore.Timestamp.fromDate(new Date(paymentIntent.created * 1000)),
              paymentMethod: {
                  last4: paymentMethodDetails?.last4 || '',
                  brand: paymentMethodDetails?.brand || '',
              },
              refund: {
                  status: 'not_refunded',
                  amount: null,
                  date: null,
              }
          },

          checkout: {
              amountTotal: session.amount_total / 100,
              currency: session.currency,
              status: session.payment_status,
              customerEmail: session.customer_email,
              customerId: userData.uid || '',
              customerName: userData.name || '',
              created: admin.firestore.Timestamp.fromDate(new Date(session.created * 1000)),
          },

          qrCodeUrl,

          eventDetails: {
              eventId: userData.eventId,
              eventTitle: userData.eventTitle,
              eventLocation: userData.eventLocation,
              eventDate: userData.eventDate,
              eventTime: userData.eventTime,
              refunds: userData.refunds,
          },
          tickets: tickets.map(ticket => ({
              ...ticket,
              id: generateUniqueTicketId(),
              status: 'valid',
          })),
          organizerDetails: {
              organizerId: organizerDetails.organizerId || '',
              organizerName: organizerDetails.organizer || ''
          },
          status: "succeeded",
          verified: false,
          termsVersion: 'v1.0'
      };

      // Attempt to save transaction data to Firestore
      console.log(`Saving transaction data for PaymentIntent ID: ${paymentIntent.id} to Firestore`);
      await saveTransactionToFirestore(transactionData);
      console.log('Transaction data successfully saved to Firestore for PaymentIntent ID:', paymentIntent.id);

  } catch (error) {
      console.error(`Error saving transaction data for PaymentIntent ID ${paymentIntent.id}:`, error);

      // If save fails, add the transaction data to the retry queue
      console.log('Adding job to transactionQueue with paymentIntentId:', paymentIntent.id);
      await transactionQueue.add('retrySaveTransaction', {
          paymentIntentId: paymentIntent.id,
          transactionData: {
              transactionId: paymentIntent.id,
              sessionId: session?.id || null,
              ...transactionData
          }
      });
      console.log(`Job added to transactionQueue for retry of PaymentIntent ID: ${paymentIntent.id}`);
  }
}


// Handler for `checkout.session.completed` event
async function handleCheckoutSessionCompleted(session) {
  try {
    const { userData, tickets, organizerDetails } = parseSessionMetadata(session.metadata);

    const qrCodeUrl = await generateQRCodeUrl({
      id: session.payment_intent,
      user: userData.uid,
      tickets,
    });

    const transactionData = {
      transactionId: session.payment_intent,
      sessionId: session.id,
      userId: userData.uid,

      checkout: {
        amountTotal: session.amount_total / 100,
        currency: session.currency,
        status: session.payment_status,
        customerEmail: session.customer_email,
        customerId: userData.uid || '',
        customerName: userData.name || '',
        created: admin.firestore.Timestamp.fromDate(new Date(session.created * 1000)),
      },

      qrCodeUrl,

      eventDetails: {
        eventId: userData.eventId,
        eventTitle: userData.eventTitle,
        eventLocation: userData.eventLocation,
        eventDate: userData.eventDate,
        eventTime: userData.eventTime,
        refunds: userData.refunds,
      },
      tickets,
      organizerDetails: {
        organizerId: organizerDetails.organizerId || '',
        organizerName: organizerDetails.organizer || ''
      },
      status: "succeeded",
      verified: false,
      termsVersion: 'v1.0'
    };

    await saveTransactionToFirestore(transactionData);
    console.log('Transaction data successfully saved to Firestore');
  } catch (error) {
    console.error('Error processing checkout session:', error);
    throw error;
  }
}

// Handler for `payment_intent.payment_failed` event
async function handlePaymentFailed(paymentIntent) {
  console.log(`Handling payment_intent.payment_failed for PaymentIntent ID: ${paymentIntent.id}`);

  const failureData = {
    status: "failed",
    failure: {
      errorCode: paymentIntent.last_payment_error?.code || 'unknown_error',
      errorMessage: paymentIntent.last_payment_error?.message || 'Unknown error occurred',
      timestamp: admin.firestore.Timestamp.now()
    }
  };

  try {
    await updateTransactionInFirestore(paymentIntent.id, failureData);
    console.log(`Failed transaction logged for PaymentIntent ID: ${paymentIntent.id}`);
  } catch (error) {
    console.error(`Error logging failed transaction for PaymentIntent ID ${paymentIntent.id}:`, error);
    throw error;
  }
}

// Handler for `checkout.session.async_payment_failed` event
async function handleAsyncPaymentFailed(session) {
  console.log(`Handling checkout.session.async_payment_failed for Session ID: ${session.id}`);

  const failureData = {
    status: "failed",
    failure: {
      errorCode: "async_payment_failed",
      errorMessage: "Asynchronous payment failed",
      timestamp: admin.firestore.Timestamp.now()
    }
  };

  try {
    await updateTransactionInFirestore(session.payment_intent, failureData);
    console.log(`Failed transaction logged for Session ID: ${session.id}`);
  } catch (error) {
    console.error(`Error logging failed transaction for Session ID ${session.id}:`, error);
    throw error;
  }
}

// Function to save transaction data to Firestore
async function saveTransactionToFirestore(transactionData) {
  try {
    const transactionRef = db.collection('transactions').doc(transactionData.transactionId);
    await transactionRef.set(transactionData, { merge: true });
    console.log('Transaction saved with ID:', transactionData.transactionId);
  } catch (error) {
    console.error('Error saving transaction to Firestore:', error);
    throw error;
  }
}

// Helper function to update transaction data in Firestore for failures
async function updateTransactionInFirestore(transactionId, data) {
  try {
    const transactionRef = db.collection('transactions').doc(transactionId);
    await transactionRef.set(data, { merge: true });
    console.log('Transaction updated with failure data:', transactionId);
  } catch (error) {
    console.error('Error updating transaction in Firestore:', error);
    throw error;
  }
}

// Function to generate unique ticket ID
function generateUniqueTicketId() {
  return '_' + Math.random().toString(36).substr(2, 9);
}

module.exports = { processStripeEvent };
