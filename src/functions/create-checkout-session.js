const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
    return {
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { tickets, user, organizerDetails } = body;

    console.log('Received tickets:', tickets);
    console.log('Received user details:', user); // Log user details for debugging
    console.log('Received organizer details:', organizerDetails); // Log organizer details for debugging

    if (!user.uid || !user.email || !user.name || !user.eventId || !user.eventTitle || !user.eventDate || !user.eventTime || !user.eventLocation) {
      throw new Error('User details are missing or incomplete');
    }

    const line_items = tickets.map(ticket => {
      const unitAmount = Math.round((ticket.price + ticket.bookingFee) * 100);
      console.log(`Calculating unit amount for ${ticket.title}: ${unitAmount} (price: ${ticket.price}, bookingFee: ${ticket.bookingFee})`);
      if (isNaN(unitAmount)) {
        throw new Error(`Invalid unit amount calculated for ${ticket.title}`);
      }
      return {
        price_data: {
          currency: 'gbp',
          product_data: {
            name: ticket.title,
          },
          unit_amount: unitAmount,
        },
        quantity: ticket.quantity,
      };
    });

    console.log('Creating Stripe session with line items:', line_items);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      customer_email: user.email,
      metadata: {
        user: JSON.stringify(user), // Convert user object to JSON string
        tickets: JSON.stringify(tickets),
        organizer: JSON.stringify(organizerDetails), // Include organizer details in metadata
      },
      success_url: process.env.SUCCESS_URL,
      cancel_url: process.env.FAILURE_URL,
    });

    console.log('Stripe session created successfully:', session.id);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ id: session.id }),
    };
  } catch (error) {
    console.error('Error creating Stripe session:', error);

    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Internal Server Error', message: error.message }),
    };
  }
};
