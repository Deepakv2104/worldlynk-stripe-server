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
  
  module.exports = { validateUserDetails, createLineItems };
  