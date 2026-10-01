import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Creates a driver account and confirms it immediately, so the demonstration
 * can sign up and sign in without waiting for an email.
 * The role is always driver. Other roles are not created here.
 */
export async function POST(request: Request) {
  let body: { fullName?: string; email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const fullName = body.fullName?.trim() ?? '';
  const email = body.email?.trim().toLowerCase() ?? '';
  const password = body.password ?? '';

  if (fullName.length < 2) {
    return NextResponse.json({ error: 'Enter the driver name.' }, { status: 400 });
  }
  if (!email.includes('@')) {
    return NextResponse.json({ error: 'Enter a valid email.' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server is not configured' },
      { status: 503 },
    );
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role: 'driver' },
  });

  if (error || !data.user) {
    const message = /already/i.test(error?.message ?? '')
      ? 'That email is already registered. Sign in instead.'
      : (error?.message ?? 'Could not create the account.');
    return NextResponse.json({ error: message }, { status: 409 });
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('auth_user_id', data.user.id)
    .maybeSingle();

  if (profile) {
    const license = `DEMO-LIC-${data.user.id.slice(0, 8)}`;
    await admin.from('drivers').insert({
      profile_id: profile.id,
      full_name: fullName,
      license_no: license,
      status: 'active',
    });
  }

  return NextResponse.json({ ok: true });
}
