const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { db } = require('./firebase');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { requestId } = JSON.parse(event.body);
console.log(requestId, "this is requestId")
    if (!requestId) {
      return { statusCode: 400, body: 'Request ID is required' };
    }

    const requestDoc = await db.collection('refundRequests').doc(requestId).get();

    if (!requestDoc.exists) {
      return { statusCode: 404, body: 'Refund request not found' };
    }

    const refundRequest = requestDoc.data();
    console.log(refundRequest, "this is refund request")

    if (refundRequest.status !== 'pending') {
      return { statusCode: 400, body: 'Refund request is not pending' };
    }

    // Check if the sessionId is actually a Payment Intent ID
    const paymentIntent = await stripe.paymentIntents.retrieve(refundRequest.orderId);
    console.log(paymentIntent.id, "paymntintendId")
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntent.id,
    });

    await db.collection('refundRequests').doc(requestId).update({
      status: 'approved',
      approvedAt: new Date(),
      refundId: refund.id,
    });

    await db.collection('payments').doc(paymentIntent.id).update({
      status: 'refunded',
      refundId: refund.id,
      refundedAt: new Date(),
    });

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ message: 'Refund approved and processed successfully.' }),
    };
  } catch (error) {
    console.error('Error processing refund:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ message: 'Internal Server Error', error: error.message }),
    };
  }
};
