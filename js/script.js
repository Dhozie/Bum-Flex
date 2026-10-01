// Bum Flex shop interactions: product details, cart, checkout, search, and mobile navigation.
document.addEventListener('DOMContentLoaded', async () => {
  const cards = [...document.querySelectorAll('.image-grid .image')];
  const seedIds = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000009'];
  let productData = cards.map((card, index) => {
    const name = card.querySelector('span')?.textContent.trim() || 'Bum Flex Shorts';
    const image = card.querySelector('img')?.getAttribute('src') || '';
    const numericPrice = Number((card.querySelector('.price')?.textContent || '').replace(/[^\d]/g, '')) || 1500;
    return { id: seedIds[index] || `bum-flex-${index + 1}`, name, price: numericPrice, image, description: `${name}, designed for comfortable movement and everyday style.` };
  });
  const cart = new Map();
  const cartStoragePrefix = 'cart_';
  const money = amount => `\u20A6${amount.toLocaleString('en-NG')}`;
  const notice = document.createElement('p');
  notice.className = 'shop-notice';
  notice.setAttribute('aria-live', 'polite');
  document.querySelector('.Landing-Page')?.prepend(notice);
  let supabaseClient = null;
  const config = window.BUM_FLEX_SUPABASE_CONFIG;
  if (window.supabase?.createClient && config?.url && config?.anonKey && config.url !== 'SUPABASE_URL' && config.anonKey !== 'SUPABASE_ANON_KEY') {
    try {
      supabaseClient = window.supabase.createClient(config.url, config.anonKey);
      const { data, error } = await supabaseClient.from('products').select('id,name,price,image,description').order('id');
      if (error) throw error;
      if (data?.length) {
        productData = data.map(product => ({ ...product, price: Number(product.price) }));
        while (cards.length > productData.length) cards.pop().remove();
        cards.forEach((card, index) => {
          const product = productData[index];
          card.hidden = false;
          card.dataset.productId = product.id;
          card.querySelector('img').src = product.image;
          card.querySelector('img').alt = product.name;
          card.querySelector('span').textContent = product.name;
          card.querySelector('.price').textContent = money(product.price);
        });
        productData.slice(cards.length).forEach(product => {
          const card = document.createElement('div');
          card.className = 'image';
          card.innerHTML = `<img src="${product.image}" alt="${product.name}"><span>${product.name}</span><p class="price">${money(product.price)}</p>`;
          document.querySelector('.image-grid').append(card);
          cards.push(card);
        });
      } else {
        notice.textContent = 'No products were returned from Supabase. The existing products remain visible.';
      }
    } catch (error) {
      console.error('Could not load Bum Flex products from Supabase:', error);
      notice.textContent = 'Products are shown from the website while the database connection is unavailable.';
    }
  } else {
    notice.textContent = 'Supabase is not configured yet. Add your project URL and anon key to js/supabase-config.js.';
  }

  // Create the shared dialog once and reuse it for details, cart, and checkout.
  const dialog = document.createElement('div');
  dialog.className = 'shop-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Bum Flex shopping');
  dialog.innerHTML = '<div class="shop-dialog-panel"><button type="button" class="dialog-close" aria-label="Close">×</button><div class="dialog-content"></div></div>';
  document.body.append(dialog);
  const dialogContent = dialog.querySelector('.dialog-content');

  function openDialog(html) {
    dialogContent.innerHTML = html;
    dialog.classList.add('is-open');
    document.body.classList.add('dialog-open');
    dialog.querySelector('.dialog-close').focus();
  }
  function closeDialog() {
    dialog.classList.remove('is-open');
    document.body.classList.remove('dialog-open');
  }
  function showMessageModal(message) {
    openDialog('<section class="auth-content"><h2 class="modal-message" aria-live="polite"></h2></section>');
    dialogContent.querySelector('.modal-message').textContent = message;
  }
  const loginLink = document.querySelector('.login-link');
  let currentUser = null;
  let authEpoch = 0;
  const pendingGoogleLoginKey = 'bum-flex-google-login-pending';

  function saveCartForUser(userId = currentUser?.id, items = [...cart.values()]) {
    if (!userId) return;
    try {
      localStorage.setItem(`${cartStoragePrefix}${userId}`, JSON.stringify(items));
    } catch (error) {
      console.error('Could not save the Bum Flex cart:', error);
    }
  }

  function loadCartForUser(userId) {
    cart.clear();
    try {
      const savedCart = JSON.parse(localStorage.getItem(`${cartStoragePrefix}${userId}`) || '[]');
      if (Array.isArray(savedCart)) {
        savedCart.forEach(item => {
          const quantity = Number(item?.quantity);
          if (item?.id && Number.isFinite(quantity) && quantity > 0) {
            cart.set(String(item.id), { ...item, quantity });
          }
        });
      }
    } catch (error) {
      console.error('Could not restore the Bum Flex cart:', error);
    }
  }

  function updateLoginLink(user) {
    const previousUserId = currentUser?.id;
    const nextUserId = user?.id;
    if (previousUserId !== nextUserId) {
      if (previousUserId) saveCartForUser(previousUserId);
      authEpoch += 1;
      cart.clear();
      if (nextUserId) loadCartForUser(nextUserId);
      updateCount();
    }
    currentUser = user || null;
    const displayName = user?.user_metadata?.full_name
      || user?.user_metadata?.name
      || user?.user_metadata?.given_name
      || user?.email?.split('@')[0]
      || 'Account';
    const firstName = displayName.trim().split(/\s+/)[0] || 'Account';
    loginLink.replaceChildren(document.createElement('i'));
    loginLink.querySelector('i').className = 'fas fa-user';
    loginLink.append(document.createTextNode(user ? `Hi, ${firstName}` : ' Login'));
    loginLink.setAttribute('aria-label', user ? `Account for ${displayName}` : 'Login with Google');
  }

  function requireAuthenticatedUser() {
    if (currentUser?.id && supabaseClient?.auth) return true;
    showGoogleLogin('Please log in to continue.');
    return false;
  }

  function showGoogleLogin(message = '') {
    openDialog('<section class="auth-content"><h2>Login to Bum Flex</h2><button class="shop-action google-login-button" type="button">Continue with Google</button><p class="auth-message" aria-live="polite"></p></section>');
    dialogContent.querySelector('.auth-message').textContent = message;
    dialogContent.querySelector('.google-login-button').addEventListener('click', startGoogleLogin);
  }

  function showAccount() {
    const name = currentUser?.user_metadata?.full_name || currentUser?.user_metadata?.name || currentUser?.email || 'Account';
    openDialog('<section class="auth-content"><h2></h2><button class="shop-action logout-button" type="button">Logout</button><p class="auth-message" aria-live="polite"></p></section>');
    dialogContent.querySelector('h2').textContent = `Hi, ${name.split(/\s+/)[0]}`;
    dialogContent.querySelector('.logout-button').addEventListener('click', async () => {
      const logoutButton = dialogContent.querySelector('.logout-button');
      logoutButton.disabled = true;
      try {
        // Clear the active identity and cart as soon as logout is requested.
        updateLoginLink(null);
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
        closeDialog();
        notice.textContent = 'You have been signed out.';
      } catch (error) {
        console.error('Could not sign out of Bum Flex:', error);
        try {
          const { data } = await supabaseClient.auth.getSession();
          updateLoginLink(data.session?.user);
        } catch (sessionError) {
          console.error('Could not restore the Bum Flex session after logout failed:', sessionError);
        }
        dialogContent.querySelector('.auth-message').textContent = 'Logout failed. Please try again.';
        dialogContent.querySelector('.logout-button')?.removeAttribute('disabled');
      }
    });
  }

  // Start Google's hosted sign-in flow using the existing Supabase client.
  async function startGoogleLogin() {
    const loginButton = dialogContent.querySelector('.google-login-button');
    const message = dialogContent.querySelector('.auth-message');
    if (!supabaseClient?.auth) {
      message.textContent = 'Login is unavailable because the Supabase connection could not be started.';
      return;
    }
    loginButton.disabled = true;
    message.textContent = '';
    try {
      sessionStorage.setItem(pendingGoogleLoginKey, 'true');
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin }
      });
      if (error) throw error;
    } catch (error) {
      console.error('Google sign-in could not start:', error);
      sessionStorage.removeItem(pendingGoogleLoginKey);
      message.textContent = 'Google sign-in could not start. Please try again.';
      loginButton.disabled = false;
    }
  }

  loginLink.addEventListener('click', event => {
    event.preventDefault();
    if (currentUser) showAccount();
    else showGoogleLogin();
  });

  // Restore an existing session and report the OAuth result after returning to this page.
  if (supabaseClient?.auth) {
    const queryParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const authError = queryParams.get('error') || queryParams.get('error_description')
      || hashParams.get('error') || hashParams.get('error_description');
    if (authError) {
      sessionStorage.removeItem(pendingGoogleLoginKey);
      notice.textContent = 'Google sign-in was cancelled or could not be completed. Please try again.';
    }
    const { data: authListener } = supabaseClient.auth.onAuthStateChange((event, session) => {
      updateLoginLink(session?.user);
      if (session?.user && sessionStorage.getItem(pendingGoogleLoginKey) === 'true') {
        sessionStorage.removeItem(pendingGoogleLoginKey);
        closeDialog();
        showMessageModal('Successfully signed in with Google');
      } else if (event === 'SIGNED_OUT') {
        notice.textContent = 'You have been signed out.';
      }
    });
    try {
      const { data, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      updateLoginLink(data.session?.user);
      if (data.session?.user && sessionStorage.getItem(pendingGoogleLoginKey) === 'true') {
        sessionStorage.removeItem(pendingGoogleLoginKey);
        showMessageModal('Successfully signed in with Google');
      }
    } catch (error) {
      console.error('Could not restore the Bum Flex sign-in session:', error);
      notice.textContent = 'Your sign-in status could not be checked. Please refresh and try again.';
    }
    window.addEventListener('pagehide', () => authListener.subscription.unsubscribe(), { once: true });
  } else {
    updateLoginLink(null);
  }

  dialog.querySelector('.dialog-close').addEventListener('click', closeDialog);
  dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeDialog(); });

  function showProduct(product) {
    openDialog(`<section class="product-detail"><img src="${product.image}" alt="${product.name}"><div><h2>${product.name}</h2><p class="detail-price">${money(product.price)}</p><p>${product.description}</p><label>Quantity <input class="detail-quantity" type="number" min="1" value="1"></label><button class="shop-action detail-add" type="button">Add to Cart</button></div></section>`);
    dialogContent.querySelector('.detail-add').addEventListener('click', () => {
      if (!requireAuthenticatedUser()) return;
      const quantity = Math.max(1, Number(dialogContent.querySelector('.detail-quantity').value) || 1);
      addToCart(product, quantity);
    });
  }

  cards.forEach((card, index) => {
    const product = productData[index];
    card.dataset.productId = product.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `View ${product.name}`);
    card.addEventListener('click', () => showProduct(product));
    card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showProduct(product); } });
  });

  function updateCount() {
    document.querySelector('.cart-count').textContent = [...cart.values()].reduce((sum, item) => sum + item.quantity, 0);
  }
  function addToCart(product, quantity = 1) {
    if (!requireAuthenticatedUser()) return;
    const existing = cart.get(product.id);
    if (existing) existing.quantity += quantity;
    else cart.set(product.id, { ...product, quantity });
    saveCartForUser();
    updateCount();
    showMessageModal('Product added to cart');
  }
  function showCart() {
    if (!requireAuthenticatedUser()) return;
    const cartOwnerId = currentUser.id;
    const cartOwnerEpoch = authEpoch;
    if (!cart.size) {
      openDialog('<h2>Your Cart</h2><p class="empty-cart">Cart is empty.</p>');
      return;
    }
    const items = [...cart.values()];
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    openDialog(`<h2>Your Cart</h2><div class="cart-items">${items.map(item => `<article class="cart-item" data-id="${item.id}"><img src="${item.image}" alt=""><div class="cart-item-info"><strong>${item.name}</strong><span>${money(item.price)} each</span><div class="quantity-controls"><button type="button" data-action="decrease" aria-label="Decrease ${item.name}">−</button><span>${item.quantity}</span><button type="button" data-action="increase" aria-label="Increase ${item.name}">+</button><button type="button" data-action="remove">Remove</button></div></div><strong>${money(item.price * item.quantity)}</strong></article>`).join('')}</div><p class="cart-total">Subtotal: <strong>${money(total)}</strong></p><p class="cart-total">Total: <strong>${money(total)}</strong></p><button class="shop-action checkout-start" type="button">Checkout</button>`);
    dialogContent.querySelectorAll('.cart-item button').forEach(button => button.addEventListener('click', () => {
      if (!requireAuthenticatedUser()) return;
      if (currentUser.id !== cartOwnerId || authEpoch !== cartOwnerEpoch) {
        showCart();
        return;
      }
      const row = button.closest('.cart-item');
      const item = cart.get(row.dataset.id);
      if (button.dataset.action === 'increase') item.quantity += 1;
      if (button.dataset.action === 'decrease') item.quantity -= 1;
      if (button.dataset.action === 'remove' || item.quantity <= 0) cart.delete(row.dataset.id);
      saveCartForUser();
      updateCount();
      showCart();
    }));
    dialogContent.querySelector('.checkout-start').addEventListener('click', showCheckout);
  }
  function showCheckout() {
    if (!requireAuthenticatedUser()) return;
    if (!cart.size) return showCart();
    const checkoutUserId = currentUser.id;
    const checkoutAuthEpoch = authEpoch;
    const items = [...cart.values()];
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    openDialog(`<h2>Checkout</h2><div class="checkout-summary">${items.map(item => `<p>${item.name} × ${item.quantity} <strong>${money(item.price * item.quantity)}</strong></p>`).join('')}<p class="cart-total">Total <strong>${money(total)}</strong></p></div><form class="checkout-form"><label>Customer name<input name="name" required autocomplete="name"></label><label>Email<input name="email" type="email" required autocomplete="email"></label><label>Phone number<input name="phone" type="tel" required autocomplete="tel"></label><label>Delivery address<textarea name="address" required autocomplete="street-address"></textarea></label><p class="checkout-error" aria-live="polite"></p><button class="shop-action" type="submit">Place Order</button></form>`);
    dialogContent.querySelector('.checkout-form').addEventListener('submit', event => {
      event.preventDefault();
      if (!requireAuthenticatedUser()) return;
      if (currentUser.id !== checkoutUserId || authEpoch !== checkoutAuthEpoch) {
        dialogContent.querySelector('.checkout-error').textContent = 'Your account changed. Please review your cart and checkout again.';
        return;
      }
      const form = event.currentTarget;
      if (!form.reportValidity()) {
        dialogContent.querySelector('.checkout-error').textContent = 'Order details required.';
        return;
      }
      const fields = new FormData(form);
      const requiredValues = ['name', 'email', 'phone', 'address'].map(field => String(fields.get(field) || '').trim());
      if (requiredValues.some(value => !value)) {
        dialogContent.querySelector('.checkout-error').textContent = 'Order details required. Please complete every field.';
        return;
      }
      submitOrder(form);
    });
  }

  // Save an order and its items through one database function so either both records are written or neither is.
  async function submitOrder(form) {
    const errorMessage = dialogContent.querySelector('.checkout-error');
    const submitButton = form.querySelector('button[type="submit"]');
    if (!requireAuthenticatedUser()) return;
    if (!supabaseClient) {
      errorMessage.textContent = 'Order could not be saved: Supabase is not configured. Your cart is still here.';
      return;
    }
    const values = new FormData(form);
    const submittingUserId = currentUser.id;
    const submittingAuthEpoch = authEpoch;
    const items = [...cart.values()];
    const total = items.reduce((sum, item) => sum + Math.round(Number(item.price) * 100) * item.quantity, 0) / 100;
    submitButton.disabled = true;
    submitButton.textContent = 'Saving order…';
    errorMessage.textContent = '';
    try {
      const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session?.user?.id || sessionData.session.user.id !== submittingUserId
        || currentUser?.id !== submittingUserId || authEpoch !== submittingAuthEpoch) {
        throw new Error('Please log in to continue.');
      }
      const { data, error } = await supabaseClient.rpc('place_bum_flex_order', {
        p_customer_name: values.get('name').trim(),
        p_customer_email: values.get('email').trim(),
        p_customer_phone: values.get('phone').trim(),
        p_customer_address: values.get('address').trim(),
        p_total_amount: total,
        p_items: items.map(item => ({ product_id: item.id, quantity: item.quantity }))
      });
      if (error) throw error;
      if (!data) throw new Error('The database did not return an order ID.');
      if (currentUser?.id === submittingUserId) {
        cart.clear();
        saveCartForUser(submittingUserId);
        updateCount();
      } else {
        saveCartForUser(submittingUserId, []);
      }
      openDialog(`<h2>Order placed successfully</h2><p>Your order was saved. Reference: ${data}</p><button class="shop-action done-button" type="button">Continue shopping</button>`);
      dialogContent.querySelector('.done-button').addEventListener('click', closeDialog);
    } catch (error) {
      console.error('Could not submit Bum Flex order:', error);
      errorMessage.textContent = error.message === 'Please log in to continue.'
        ? error.message
        : `Order could not be saved. ${error.message || 'Please try again.'} Your cart is still here.`;
      submitButton.disabled = false;
      submitButton.textContent = 'Place Order';
    }
  }

  document.querySelector('.cart-link').addEventListener('click', event => { event.preventDefault(); showCart(); });
  document.querySelector('.buy-now').addEventListener('click', () => document.querySelector('.Landing-Page').scrollIntoView({ behavior: 'smooth' }));

  // Filter existing product cards as the customer types.
  const searchInput = document.querySelector('.Search input');
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase();
    let visible = 0;
    cards.forEach((card, index) => {
      const match = productData[index].name.toLowerCase().includes(query);
      card.hidden = !match;
      if (match) visible += 1;
    });
    notice.textContent = visible ? '' : 'No products found.';
  });
  document.querySelector('.Search').addEventListener('submit', event => event.preventDefault());

  // Expand the current navigation on small screens and close it after navigation.
  const menuToggle = document.querySelector('.menu-toggle');
  const navbar = document.querySelector('.navbar');
  menuToggle.addEventListener('click', () => {
    const isOpen = navbar.classList.toggle('menu-open');
    menuToggle.setAttribute('aria-expanded', String(isOpen));
    menuToggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
  });
  document.querySelectorAll('.nav-links a').forEach(link => link.addEventListener('click', () => {
    navbar.classList.remove('menu-open');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open navigation');
  }));
});
