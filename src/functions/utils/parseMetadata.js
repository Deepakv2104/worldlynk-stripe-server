function parseSessionMetadata(metadata) {
    let userData = {};
    let tickets = [];
    let organizerDetails = {};
  
    try {
      if (metadata) {
        if (metadata.user) {
          userData = JSON.parse(metadata.user);
        }
        if (metadata.tickets) {
          tickets = JSON.parse(metadata.tickets);
        }
        if (metadata.organizer) {
          organizerDetails = JSON.parse(metadata.organizer);
        }
      }
    } catch (error) {
      console.error('Error parsing session metadata:', error);
    }
  
    return { userData, tickets, organizerDetails };
  }
  
  module.exports = { parseSessionMetadata };
  