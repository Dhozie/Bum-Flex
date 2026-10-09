import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

type Product = { id: string; name: string; price: number; image: string; description: string };
type CartLine = Product & { quantity: number };
type Tab = 'shop' | 'cart' | 'account';

const money = (amount: number) => `₦${Number(amount || 0).toLocaleString('en-NG')}`;
const imageUrl = (path: string) => path.startsWith('http') ? path : `https://bumflex.netlify.app/${path.replace(/^\//, '')}`;

export default function HomeScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>('shop');
  const [products, setProducts] = useState<Product[]>([]);
  const [cartId, setCartId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [error, setError] = useState('');
  const processedCodes = useRef(new Set<string>());

  const cartCount = useMemo(() => cart.reduce((sum, line) => sum + line.quantity, 0), [cart]);
  const total = useMemo(
    () => cart.reduce((sum, line) => sum + Math.round(Number(line.price) * 100) * line.quantity, 0) / 100,
    [cart],
  );

  async function loadProducts() {
    const { data, error: queryError } = await supabase
      .from('products')
      .select('id,name,price,image,description')
      .order('name');
    if (queryError) setError(queryError.message);
    else setProducts((data || []).map((product) => ({ ...product, price: Number(product.price) })));
  }

  async function loadCart(id: string) {
    const { data, error: queryError } = await supabase
      .from('cart_items')
      .select('product_id,quantity,products(id,name,price,image,description)')
      .eq('cart_id', id);
    if (queryError) {
      setError(queryError.message);
      return;
    }
    setCart((data || []).flatMap((row) => {
      const nested = row.products;
      const product = Array.isArray(nested) ? nested[0] : nested;
      return product ? [{ ...product, price: Number(product.price), quantity: row.quantity }] : [];
    }));
  }

  async function getOrCreateCart(userId: string) {
    const { data, error: upsertError } = await supabase
      .from('carts')
      .upsert({ user_id: userId }, { onConflict: 'user_id' })
      .select('id')
      .single();
    if (upsertError) {
      setError(`Could not open your shared cart: ${upsertError.message}`);
      setCartId(null);
      setCart([]);
      return;
    }
    setCartId(data.id);
    await loadCart(data.id);
  }

  useEffect(() => {
    let alive = true;
    loadProducts().finally(() => { if (alive) setLoading(false); });
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setSession(data.session);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setError('');
    });
    const linkingSubscription = Linking.addEventListener('url', ({ url }) => {
      void finishOAuth(url);
    });
    Linking.getInitialURL().then((url) => { if (url) void finishOAuth(url); });
    return () => {
      alive = false;
      authListener.subscription.unsubscribe();
      linkingSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setCartId(null);
      setCart([]);
      return;
    }
    void getOrCreateCart(session.user.id);
  }, [session?.user.id]);

  useEffect(() => {
    if (!cartId) return;
    const channel = supabase.channel(`mobile-cart-${cartId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'cart_items', filter: `cart_id=eq.${cartId}`,
      }, () => { void loadCart(cartId); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [cartId]);

  async function finishOAuth(url: string) {
    try {
      const parsed = new URL(url);
      const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
      const code = parsed.searchParams.get('code');
      if (code) {
        if (processedCodes.current.has(code)) return;
        processedCodes.current.add(code);
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) setError(exchangeError.message);
        return;
      }
      const accessToken = parsed.searchParams.get('access_token') || hash.get('access_token');
      const refreshToken = parsed.searchParams.get('refresh_token') || hash.get('refresh_token');
      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (sessionError) setError(sessionError.message);
      }
      const authError = parsed.searchParams.get('error_description') || hash.get('error_description');
      if (authError) setError(decodeURIComponent(authError.replaceAll('+', ' ')));
    } catch {
      setError('Could not finish sign-in. Please try again.');
    }
  }

  async function signInWithGoogle() {
    setError('');
    setAuthBusy(true);
    try {
      const redirectTo = Linking.createURL('auth/callback');
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
      });
      if (oauthError) throw oauthError;
      if (!data.url) throw new Error('Google sign-in did not return a login link.');
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success') await finishOAuth(result.url);
      else if (result.type === 'cancel' || result.type === 'dismiss') setError('Sign-in was cancelled.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Google sign-in could not be completed.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function signInWithEmail() {
    if (!email.trim() || !password) {
      setError('Enter the email and password for your Bum Flex account.');
      return;
    }
    setAuthBusy(true);
    setError('');
    const { error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setAuthBusy(false);
    if (loginError) setError(loginError.message);
  }

  async function addToCart(product: Product) {
    if (!session) { setTab('account'); return; }
    if (!cartId) { setError('Your shared cart is still loading. Try again in a moment.'); return; }
    setBusyId(product.id);
    setError('');
    const existing = cart.find((line) => line.id === product.id);
    const nextQuantity = (existing?.quantity || 0) + 1;
    const { error: saveError } = await supabase.from('cart_items').upsert(
      { cart_id: cartId, product_id: product.id, quantity: nextQuantity },
      { onConflict: 'cart_id,product_id' },
    );
    if (saveError) setError(saveError.message);
    else await loadCart(cartId);
    setBusyId(null);
  }

  async function changeQuantity(item: CartLine, delta: number) {
    if (!cartId) return;
    const nextQuantity = item.quantity + delta;
    const query = nextQuantity <= 0
      ? supabase.from('cart_items').delete().eq('cart_id', cartId).eq('product_id', item.id)
      : supabase.from('cart_items').update({ quantity: nextQuantity }).eq('cart_id', cartId).eq('product_id', item.id);
    const { error: updateError } = await query;
    if (updateError) setError(updateError.message);
    else await loadCart(cartId);
  }

  async function checkout() {
    if (!session || cart.length === 0) return;
    if (!customerName.trim() || !phone.trim() || !address.trim()) {
      setError('Enter your name, phone number, and delivery address.');
      return;
    }
    setAuthBusy(true);
    setError('');
    const { data: orderId, error: orderError } = await supabase.rpc('place_bum_flex_order', {
      p_customer_name: customerName.trim(),
      p_customer_email: session.user.email || email.trim(),
      p_customer_phone: phone.trim(),
      p_customer_address: address.trim(),
      p_total_amount: total,
      p_items: cart.map((item) => ({ product_id: item.id, quantity: item.quantity })),
    });
    if (orderError || !orderId) {
      setAuthBusy(false);
      setError(orderError?.message || 'Order could not be saved.');
      return;
    }
    const { error: clearError } = await supabase.from('cart_items').delete().eq('cart_id', cartId!);
    const { error: emailError } = await supabase.functions.invoke('checkout-confirmation', { body: { order_id: orderId } });
    setAuthBusy(false);
    await loadCart(cartId!);
    const followUp = [
      clearError ? 'Your cart could not be cleared automatically.' : '',
      emailError ? 'The order was saved, but the confirmation email could not be sent.' : '',
    ].filter(Boolean).join('\n');
    Alert.alert('Order received', `Your order was saved. Reference: ${orderId}${followUp ? `\n${followUp}` : ''}`);
  }

  async function refresh() {
    setRefreshing(true);
    await loadProducts();
    if (cartId) await loadCart(cartId);
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View><Text style={styles.brand}>Bum<Text style={styles.brandAccent}>Flex</Text></Text><Text style={styles.tagline}>MOVE FREELY</Text></View>
        <Pressable style={styles.cartPill} onPress={() => setTab('cart')}><Text style={styles.cartPillText}>Cart · {cartCount}</Text></Pressable>
      </View>
      <View style={styles.tabs}>
        {(['shop', 'cart', 'account'] as Tab[]).map((value) => (
          <Pressable key={value} onPress={() => setTab(value)} style={[styles.tab, tab === value && styles.activeTab]}>
            <Text style={[styles.tabText, tab === value && styles.activeTabText]}>{value === 'shop' ? 'Shop' : value === 'cart' ? `Cart (${cartCount})` : 'Account'}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={COLORS.pink} />}
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {tab === 'shop' && <>
          <View style={styles.hero}>
            <Text style={styles.heroEyebrow}>MADE FOR MOVEMENT</Text>
            <Text style={styles.heroTitle}>Move freely.{ '\n' }Look fierce.</Text>
            <Text style={styles.heroCopy}>Comfort that moves with you.</Text>
          </View>
          <Text style={styles.sectionTitle}>Shop the collection</Text>
          {!session && <Pressable style={styles.notice} onPress={() => setTab('account')}><Text style={styles.noticeText}>Sign in to see your saved cart from the website.</Text></Pressable>}
          {loading ? <ActivityIndicator color={COLORS.pink} style={{ marginTop: 30 }} /> : (
            <View style={styles.grid}>
              {products.map((product) => (
                <View key={product.id} style={styles.productCard}>
                  <Image source={{ uri: imageUrl(product.image) }} style={styles.productImage} resizeMode="cover" />
                  <Text numberOfLines={1} style={styles.productName}>{product.name}</Text>
                  <Text style={styles.price}>{money(product.price)}</Text>
                  <Pressable style={styles.addButton} onPress={() => { void addToCart(product); }} disabled={busyId === product.id}>
                    <Text style={styles.addButtonText}>{busyId === product.id ? 'Adding…' : 'Add to cart'}</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </>}

        {tab === 'cart' && <>
          <Text style={styles.sectionTitle}>Your cart</Text>
          {!session ? <View style={styles.empty}><Text style={styles.emptyTitle}>Sign in to open your shared cart</Text><Text style={styles.muted}>Use the same Google account as the website.</Text><Pressable style={styles.primaryButton} onPress={() => setTab('account')}><Text style={styles.primaryText}>Sign in</Text></Pressable></View> : cart.length === 0 ? (
            <View style={styles.empty}><Text style={styles.emptyTitle}>Your cart is empty</Text><Text style={styles.muted}>Add something you love from the collection.</Text><Pressable style={styles.primaryButton} onPress={() => setTab('shop')}><Text style={styles.primaryText}>Browse products</Text></Pressable></View>
          ) : <>
            {cart.map((item) => <View style={styles.cartLine} key={item.id}>
              <Image source={{ uri: imageUrl(item.image) }} style={styles.cartImage} />
              <View style={styles.cartDetails}><Text style={styles.productName}>{item.name}</Text><Text style={styles.muted}>{money(item.price)} each</Text><View style={styles.quantityRow}>
                <Pressable style={styles.quantityButton} onPress={() => { void changeQuantity(item, -1); }}><Text style={styles.quantityText}>−</Text></Pressable>
                <Text style={styles.quantityValue}>{item.quantity}</Text>
                <Pressable style={styles.quantityButton} onPress={() => { void changeQuantity(item, 1); }}><Text style={styles.quantityText}>+</Text></Pressable>
              </View></View>
              <Text style={styles.linePrice}>{money(item.price * item.quantity)}</Text>
            </View>)}
            <View style={styles.totalRow}><Text style={styles.totalLabel}>Total</Text><Text style={styles.totalValue}>{money(total)}</Text></View>
            <Text style={styles.formHeading}>Delivery details</Text>
            <TextInput style={styles.input} placeholder="Customer name" value={customerName} onChangeText={setCustomerName} />
            <TextInput style={styles.input} placeholder="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <TextInput style={[styles.input, styles.addressInput]} placeholder="Delivery address" value={address} onChangeText={setAddress} multiline />
            <Pressable style={[styles.primaryButton, authBusy && styles.disabled]} onPress={() => { void checkout(); }} disabled={authBusy}>
              <Text style={styles.primaryText}>{authBusy ? 'Placing order…' : 'Place order'}</Text>
            </Pressable>
          </>}
        </>}

        {tab === 'account' && <>
          <Text style={styles.sectionTitle}>Your account</Text>
          {session ? <View style={styles.accountCard}>
            <Text style={styles.welcome}>You’re signed in</Text>
            <Text style={styles.muted}>{session.user.email}</Text>
            <Text style={styles.accountHint}>Your app and website now use the same Supabase cart for this account.</Text>
            <Pressable style={styles.secondaryButton} onPress={() => { void supabase.auth.signOut(); }}><Text style={styles.secondaryText}>Sign out</Text></Pressable>
          </View> : <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.accountCard}>
              <Text style={styles.welcome}>Sign in to Bum Flex</Text>
              <Text style={styles.muted}>Use the same Google account you use on the website to share your cart.</Text>
              <Pressable style={[styles.googleButton, authBusy && styles.disabled]} onPress={() => { void signInWithGoogle(); }} disabled={authBusy}>
                <Text style={styles.googleText}>{authBusy ? 'Opening Google…' : 'Continue with Google'}</Text>
              </Pressable>
              <Text style={styles.orText}>or sign in with email and password</Text>
              <TextInput style={styles.input} placeholder="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
              <TextInput style={styles.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
              <Pressable style={[styles.primaryButton, authBusy && styles.disabled]} onPress={() => { void signInWithEmail(); }} disabled={authBusy}>
                <Text style={styles.primaryText}>{authBusy ? 'Signing in…' : 'Sign in'}</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>}
        </>}
      </ScrollView>
    </SafeAreaView>
  );
}

const COLORS = { pink: '#f44370', ink: '#191923', muted: '#777782', pale: '#fff4f6', line: '#eeeeef', white: '#ffffff' };
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  header: { height: 68, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: COLORS.line },
  brand: { fontSize: 23, fontWeight: '900', fontStyle: 'italic', color: COLORS.ink, letterSpacing: -1 },
  brandAccent: { color: COLORS.pink },
  tagline: { fontSize: 8, color: COLORS.muted, letterSpacing: 2, marginTop: -1 },
  cartPill: { backgroundColor: COLORS.pale, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 22 },
  cartPillText: { color: COLORS.pink, fontWeight: '800' },
  tabs: { flexDirection: 'row', paddingHorizontal: 14, paddingTop: 8, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: COLORS.pink },
  tabText: { color: COLORS.muted, fontWeight: '700' },
  activeTabText: { color: COLORS.pink },
  content: { padding: 18, paddingBottom: 36 },
  hero: { padding: 24, minHeight: 190, justifyContent: 'center', backgroundColor: COLORS.ink, borderRadius: 22, marginBottom: 26 },
  heroEyebrow: { color: '#ff8ba5', fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 10 },
  heroTitle: { color: COLORS.white, fontSize: 34, lineHeight: 38, fontWeight: '900', letterSpacing: -1 },
  heroCopy: { color: '#d3d3da', marginTop: 10, fontSize: 14 },
  sectionTitle: { color: COLORS.ink, fontSize: 24, fontWeight: '900', marginBottom: 15, letterSpacing: -0.5 },
  notice: { backgroundColor: COLORS.pale, padding: 13, borderRadius: 12, marginBottom: 14 },
  noticeText: { color: COLORS.pink, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  productCard: { width: '48%', backgroundColor: COLORS.white, borderRadius: 16, borderWidth: 1, borderColor: COLORS.line, overflow: 'hidden', paddingBottom: 12 },
  productImage: { height: 170, width: '100%', backgroundColor: '#f2f2f4' },
  productName: { color: COLORS.ink, fontWeight: '800', fontSize: 14, marginHorizontal: 11, marginTop: 11 },
  price: { color: COLORS.pink, fontWeight: '900', fontSize: 15, marginHorizontal: 11, marginTop: 5 },
  addButton: { marginHorizontal: 10, marginTop: 11, backgroundColor: COLORS.ink, borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
  addButtonText: { color: COLORS.white, fontSize: 12, fontWeight: '800' },
  error: { color: '#b4233e', backgroundColor: '#fff0f2', padding: 12, borderRadius: 10, marginBottom: 14, lineHeight: 20 },
  empty: { padding: 24, backgroundColor: '#fafafa', borderWidth: 1, borderColor: COLORS.line, borderRadius: 18, alignItems: 'center' },
  emptyTitle: { color: COLORS.ink, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  muted: { color: COLORS.muted, marginTop: 7, lineHeight: 20 },
  primaryButton: { backgroundColor: COLORS.pink, paddingVertical: 15, paddingHorizontal: 20, borderRadius: 13, alignItems: 'center', marginTop: 16 },
  primaryText: { color: COLORS.white, fontWeight: '900', fontSize: 15 },
  disabled: { opacity: 0.65 },
  cartLine: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  cartImage: { width: 68, height: 78, borderRadius: 11, backgroundColor: '#f2f2f4' },
  cartDetails: { flex: 1, marginHorizontal: 12 },
  quantityRow: { flexDirection: 'row', alignItems: 'center', marginTop: 9, gap: 12 },
  quantityButton: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.pale, borderRadius: 8 },
  quantityText: { color: COLORS.pink, fontSize: 19, fontWeight: '800', marginTop: -2 },
  quantityValue: { color: COLORS.ink, fontWeight: '800' },
  linePrice: { color: COLORS.ink, fontWeight: '900', fontSize: 13 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  totalLabel: { color: COLORS.ink, fontSize: 18, fontWeight: '800' },
  totalValue: { color: COLORS.ink, fontSize: 18, fontWeight: '900' },
  formHeading: { marginTop: 22, marginBottom: 10, color: COLORS.ink, fontSize: 17, fontWeight: '900' },
  input: { borderWidth: 1, borderColor: '#dedee2', backgroundColor: COLORS.white, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 12, fontSize: 15, color: COLORS.ink, marginTop: 10 },
  addressInput: { minHeight: 85, textAlignVertical: 'top' },
  accountCard: { padding: 20, backgroundColor: '#fafafa', borderWidth: 1, borderColor: COLORS.line, borderRadius: 18 },
  welcome: { color: COLORS.ink, fontSize: 21, fontWeight: '900' },
  accountHint: { color: COLORS.muted, lineHeight: 21, marginTop: 18 },
  secondaryButton: { borderWidth: 1, borderColor: COLORS.pink, padding: 13, borderRadius: 12, alignItems: 'center', marginTop: 20 },
  secondaryText: { color: COLORS.pink, fontWeight: '900' },
  googleButton: { padding: 14, backgroundColor: COLORS.white, borderWidth: 1, borderColor: '#dadade', borderRadius: 12, alignItems: 'center', marginTop: 22 },
  googleText: { color: COLORS.ink, fontSize: 15, fontWeight: '800' },
  orText: { color: COLORS.muted, textAlign: 'center', fontSize: 12, marginTop: 18, marginBottom: 2 },
});
