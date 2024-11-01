const { stripe, verifyStripeWebhook } = require('./services/stripeService');
const { processStripeEvent } = require('./services/firestoreService');
const { corsHeaders, handleOptions } = require('./utils/cors');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();

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
