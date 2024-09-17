const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const handleOptions = () => ({
  statusCode: 200,
  headers: corsHeaders,
  body: '',
});

const validateUserDetails = (user) => {
  const requiredFields = ['uid', 'email', 'name', 'eventId', 'eventTitle', 'eventDate', 'eventTime', 'eventLocation'];
  for (const field of requiredFields) {
    if (!user[field]) {
      throw new Error(`Missing required user field: ${field}`);
    }
  }
};

const createLineItems = (tickets) => {
  return tickets.map(ticket => {
    const unitAmount = Math.round((ticket.price + ticket.bookingFee) * 100);
    if (isNaN(unitAmount) || unitAmount <= 0) {
      throw new Error(`Invalid unit amount calculated for ${ticket.title}`);
    }
    return {
      price_data: {
        currency: 'gbp',
        product_data: { name: ticket.title },
        unit_amount: unitAmount,
      },
      quantity: ticket.quantity,
    };
  });
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return handleOptions();
  }

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
      body: JSON.stringify({
        error: error.message || 'Internal Server Error',
      }),
    };
  }
};