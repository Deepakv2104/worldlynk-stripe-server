const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
  };
  
  const handleOptions = () => ({
    statusCode: 200,
    headers: corsHeaders,
    body: '',
  });
  
  module.exports = { corsHeaders, handleOptions };
  