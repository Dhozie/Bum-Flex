// Send contact messages through the deployed Supabase Edge Function.
document.addEventListener('DOMContentLoaded', () => {
  const contactForm = document.querySelector('#contact-form');
  const statusMessage = document.querySelector('.contact-status');
  if (!contactForm || !statusMessage) return;

  const submitButton = contactForm.querySelector('button[type="submit"]');
  const functionUrl = 'https://suejcsaxisgbdsvuifub.supabase.co/functions/v1/swift-service';

  contactForm.addEventListener('submit', async event => {
    event.preventDefault();
    statusMessage.textContent = '';
    if (!contactForm.reportValidity()) return;

    const formValues = new FormData(contactForm);
    const messageDetails = {
      name: String(formValues.get('name') || '').trim(),
      email: String(formValues.get('email') || '').trim(),
      message: String(formValues.get('message') || '').trim()
    };

    if (!messageDetails.name || !messageDetails.email || !messageDetails.message) {
      statusMessage.textContent = 'Please enter your name, email, and message.';
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Sending…';
    contactForm.setAttribute('aria-busy', 'true');

    try {
      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(messageDetails)
      });

      if (!response.ok) {
        throw new Error(`The contact service returned ${response.status}.`);
      }

      statusMessage.textContent = 'Your message was sent successfully.';
      contactForm.reset();
    } catch (error) {
      console.error('Could not send the Bum Flex contact message:', error);
      statusMessage.textContent = 'We could not send your message right now. Please try again shortly.';
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Send Message';
      contactForm.removeAttribute('aria-busy');
    }
  });
});
