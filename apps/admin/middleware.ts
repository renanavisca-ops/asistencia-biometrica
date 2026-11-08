import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC = ['/login'];

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;
  if (!user) {
    if (PUBLIC.includes(path)) return res;
    return NextResponse.redirect(new URL('/login', req.url));
  }
  // MFA obligatorio: sin aal2 solo se permite la pantalla de MFA (las políticas RLS también lo exigen).
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== 'aal2' && path !== '/mfa') return NextResponse.redirect(new URL('/mfa', req.url));
  if (aal?.currentLevel === 'aal2' && (path === '/mfa' || path === '/login')) return NextResponse.redirect(new URL('/', req.url));
  return res;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
