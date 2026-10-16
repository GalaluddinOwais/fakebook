'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Mode = 'login' | 'signup';

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('signup');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('confirmed') === '1') {
      setMode('login');
      setMessage('Email confirmed. You can now log in.');
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
    const username = String(form.get('username') || '').trim().toLowerCase();

    try {
      const supabase = createClient();
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name, username },
            emailRedirectTo: `${window.location.origin}/auth?confirmed=1`,
          },
        });
        if (error) {
          setMessage(error.message);
        } else if (data.session) {
          window.location.href = '/';
          return;
        } else {
          setMode('login');
          setMessage('Confirmation email sent. Confirm your email, then log in here.');
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

  return <main className="auth-page">
    <Link className="brand" href="/">fakebook<span>✳</span></Link>
    <div className="auth-card">
      <p className="eyebrow">YOUR NEIGHBORHOOD AWAITS</p>
      <h1>{mode === 'signup' ? 'Come on in.' : 'Welcome back.'}</h1>
      <p className="muted">{mode === 'signup' ? 'A little space to share the everyday.' : 'Pick up right where you left off.'}</p>
      <form action={submit}>
        {mode === 'signup' && <>
          <input name="display_name" placeholder="Display name" required disabled={pending}/>
          <input name="username" placeholder="Choose a username" pattern="[a-zA-Z0-9_]{3,24}" required disabled={pending}/>
        </>}
        <input type="email" name="email" placeholder="Email address" required disabled={pending}/>
        <input type="password" name="password" minLength={8} placeholder="Password (8+ characters)" required disabled={pending}/>
        <button className="button wide" disabled={pending} aria-busy={pending}>
          {pending && <span className="button-spinner" aria-hidden="true"/>}
          {pending ? (mode === 'login' ? 'Signing in...' : 'Creating account...') : (mode === 'signup' ? 'Create account' : 'Log in')}
          {!pending && <span>↗</span>}
        </button>
      </form>
      {message && <p className="form-message" role="status">{message}</p>}
      <button className="text-button" disabled={pending} onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setMessage(''); }}>
        {mode === 'signup' ? 'Already a member? Log in' : 'New here? Create an account'}
      </button>
      <Link className="back-link" href="/">← Back to the feed</Link>
    </div>
  </main>;
}
