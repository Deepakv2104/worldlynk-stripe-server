require('dotenv').config();
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
    const { tickets } = JSON.parse(event.body);

    console.log('Received tickets:', tickets); // Log received tickets

    const line_items = tickets.map(ticket => {
      const unitAmount = (ticket.price + ticket.bookingFee) * 100;
      console.log(`Calculating unit amount for ${ticket.title}: ${unitAmount} (price: ${ticket.price}, bookingFee: ${ticket.bookingFee})`); // Log calculation
      if (isNaN(unitAmount)) {
        console.error(`Invalid unit amount calculated for ${ticket.title}`);
      }
      return {
        price_data: {
          currency: 'gbp',
          product_data: {
            name: ticket.title,
          },
          unit_amount: unitAmount, // Stripe amount is in cents
        },
        quantity: ticket.quantity,
      };
    });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: 'https://worldlynk.co.uk/success', // Your success URL
      cancel_url: 'https://worldlynk.co.uk/user-dashboard/events', // Your cancel URL
    });

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ id: session.id }),
    };
  } catch (error) {
    console.error('Error creating Stripe session:', error); // Log Stripe error
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Internal Server Error' }),
    };
  }
};
