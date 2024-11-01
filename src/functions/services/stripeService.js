const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const verifyStripeWebhook = (event) => {
  const sig = event.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  return stripe.webhooks.constructEvent(event.body, sig, endpointSecret);
};

module.exports = { stripe, verifyStripeWebhook };
