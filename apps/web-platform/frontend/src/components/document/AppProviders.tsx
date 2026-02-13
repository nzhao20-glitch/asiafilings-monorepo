'use client';

// STUB: @pdf-viewer/react package is not installed
// import { RPConfig } from '@pdf-viewer/react';
import { ReactNode } from 'react';

interface AppProvidersProps {
  children: ReactNode;
  licenseKey?: string;
}

/**
 * AppProviders - STUB IMPLEMENTATION
 *
 * ⚠️ WARNING: This is a stub implementation.
 * The @pdf-viewer/react package is not installed.
 * This component currently just renders children without PDF viewer configuration.
 *
 * TODO: Install and configure @pdf-viewer/react package if needed
 */
export function AppProviders({ children }: Omit<AppProvidersProps, '_licenseKey'>) {
  // Stub: Just render children without PDF viewer configuration
  return <>{children}</>;
}

export default AppProviders;
