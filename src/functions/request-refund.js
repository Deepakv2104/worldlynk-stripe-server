const { db } = require('./firebase');

exports.handler = async (event) => {
  // Handle CORS preflight request
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

  // Ensure only POST requests are allowed
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: 'Method Not Allowed',
    };
  }

  try {
    // Parse and validate the request body
    const { checkoutId, userId, reason } = JSON.parse(event.body);
    console.log(`Received request for Checkout ID: ${checkoutId}, User ID: ${userId}, Reason: ${reason}`);

    if (!checkoutId || !userId || !reason) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: 'Checkout ID, User ID, and reason are required' }),
      };
    }

    // Add the refund request to the Firestore database and get the document reference
    const docRef = await db.collection('refundRequests').add({
      checkoutId,
      userId,
      reason,
      status: 'pending',
      requestedAt: new Date(),
    });

    // Get the document ID
    const requestId = docRef.id;

    // Update the document with the document ID
    await docRef.update({ requestId });

    // Return a success response
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: 'Refund request submitted successfully.', requestId }),
    };
  } catch (error) {
    console.error('Error submitting refund request:', error);

    // Return an error response in case of failure
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: 'Internal Server Error', error: error.message }),
    };
  }
};
