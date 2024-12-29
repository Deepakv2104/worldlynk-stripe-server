const { stripe } = require('./services/stripeService');
const { validateUserDetails, createLineItems } = require('./utils/validation');
const { corsHeaders, handleOptions } = require('./utils/cors');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    const { tickets, user, organizerDetails } = JSON.parse(event.body);

    validateUserDetails(user);

    const line_items = createLineItems(tickets);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      customer_email: user.email,
      metadata: {
        user: JSON.stringify(user),
        tickets: JSON.stringify(tickets),
        organizer: JSON.stringify(organizerDetails),
      },
      success_url: `${process.env.SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: process.env.FAILURE_URL,
    });
    

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ id: session.id }),
    };
  } catch (error) {
    console.error('Error creating Stripe session:', error);
    return {
      statusCode: error.statusCode || 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message || 'Internal Server Error' }),
    };
  }
};
