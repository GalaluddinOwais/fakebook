'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Mode = 'login' | 'signup';

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('signup');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState('');

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('confirmed') === '1') {
      setMode('login');
      setMessage('Email confirmed. You can now log in.');
      window.history.replaceState({}, '', '/auth');
    } else if (url.searchParams.get('mode') === 'login') {
      setMode('login');
      window.history.replaceState({}, '', '/auth');
    } else if (url.searchParams.has('error')) {
      const description = url.searchParams.get('error_description');
      setMode('login');
      setMessage(description ? description.replaceAll('+', ' ') : 'Email confirmation failed. Request a new confirmation email.');
      window.history.replaceState({}, '', '/auth');
    }
  }, []);

  async function submit(form: FormData) {
    if (pending) return;
    setPending(true);
    setMessage('');
    const email = String(form.get('email') || '').trim();
    const password = String(form.get('password') || '');
    const display_name = String(form.get('display_name') || '').trim();

    try {
      const supabase = createClient();
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name },
            emailRedirectTo: `${window.location.origin}/auth?confirmed=1`,
          },
        });
        if (error) {
          setMessage(error.message);
        } else if (data.session) {
          window.location.href = '/';
          return;
        } else if (data.user?.identities?.length === 0) {
          setConfirmationEmail(email);
          setMode('login');
          setMessage('An account already exists for this email. Try logging in, or resend confirmation if it is not verified yet.');
        } else {
          setConfirmationEmail(email);
          setMode('login');
          setMessage('If confirmation is required, check your inbox and spam folder. Confirm your email, then log in here.');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setMessage(error.message);
        } else {
          window.location.href = '/';
          return;
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Authentication failed. Please try again.');
    } finally {
      setPending(false);
    }
  }

  async function resendConfirmation() {
    if (!confirmationEmail || pending) return;
    setPending(true);
    setMessage('');
    try {
      const { error } = await createClient().auth.resend({
        type: 'signup',
        email: confirmationEmail,
        options: { emailRedirectTo: `${window.location.origin}/auth?confirmed=1` },
      });
      setMessage(error ? error.message : 'If this account still needs confirmation, a new email is on its way. Check your inbox and spam folder.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not resend the confirmation email. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return <main className="auth-page">
    <Link className="brand" href="/">fakebook<span>✳</span></Link>
    <div className="auth-card">
      <p className="eyebrow">YOUR NEIGHBORHOOD AWAITS</p>
      <h1>{mode === 'signup' ? 'Come on in.' : 'Welcome back.'}</h1>
      <p className="muted">{mode === 'signup' ? 'A little space to share the everyday.' : 'Pick up right where you left off.'}</p>
      <form action={submit}>
        {mode === 'signup' && <>
          <input name="display_name" placeholder="Display name" required disabled={pending}/>
        </>}
        <input type="email" name="email" placeholder="Email address" required disabled={pending}/>
        <input type="password" name="password" minLength={8} placeholder="Password (8+ characters)" required disabled={pending}/>
        <button className="button wide" disabled={pending} aria-busy={pending}>
          {pending && <span className="button-spinner" aria-hidden="true"/>}
          {pending ? (mode === 'login' ? 'Signing in...' : 'Creating account...') : (mode === 'signup' ? 'Create account' : 'Log in')}
          {!pending && <span>↗</span>}
        </button>
      </form>
      {confirmationEmail && <button className="text-button" type="button" disabled={pending} onClick={resendConfirmation}>{pending ? 'Sending...' : 'Resend confirmation email'}</button>}
      {message && <p className="form-message" role="status">{message}</p>}
      <button className="text-button" type="button" disabled={pending} onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setMessage(''); if (mode === 'login') setConfirmationEmail(''); }}>
        {mode === 'signup' ? 'Already a member? Log in' : 'New here? Create an account'}
      </button>
      <Link className="back-link" href="/">← Back to the feed</Link>
    </div>
  </main>;
}
