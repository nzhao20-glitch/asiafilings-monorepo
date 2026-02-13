import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that don't require authentication
const publicRoutes = [
  '/login',
  '/register',
  '/pricing',
  '/features',
  '/contact',
];

// Routes that should redirect to home if already logged in
const authRoutes = [
  '/login',
  '/register',
];

// Static assets and API routes to skip
const skipPatterns = [
  '/_next',
  '/api',
  '/favicon',
  '/images',
  '/fonts',
  '/static',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for static assets and API routes
  if (skipPatterns.some(pattern => pathname.startsWith(pattern))) {
    return NextResponse.next();
  }

  // Skip for file extensions (images, etc.)
  if (pathname.includes('.')) {
    return NextResponse.next();
  }

  // Check for access token in cookies
  const accessToken = request.cookies.get('accessToken')?.value;
  const isAuthenticated = !!accessToken;

  // Check if current route is public
  const isPublicRoute = publicRoutes.some(route =>
    pathname === route || pathname.startsWith(route + '/')
  );

  // Check if current route is an auth route (login/register)
  const isAuthRoute = authRoutes.some(route => pathname === route || pathname.startsWith(route + '/'));

  // If user is authenticated and trying to access auth routes, redirect to home
  if (isAuthenticated && isAuthRoute) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // If user is not authenticated and trying to access protected route, redirect to login
  if (!isAuthenticated && !isPublicRoute) {
    // Store the original URL to redirect back after login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// Configure which routes the middleware runs on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*|api).*)',
  ],
};
