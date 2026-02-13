'use client';

import { FilingViewerProvider, useFilingViewer } from '@/src/contexts/FilingViewerContext';
import { DocumentViewer } from '@/src/components/document/DocumentViewer';

function FilingViewerContent() {
  const { currentFiling, stockCode } = useFilingViewer();

  if (!currentFiling) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading filing document...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-50">
      <DocumentViewer filing={currentFiling} stockCode={stockCode || undefined} />
    </div>
  );
}

export default function FilingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <FilingViewerProvider>
      {/* Hidden children that update the context */}
      <div style={{ display: 'none' }}>{children}</div>
      {/* Persistent viewer */}
      <FilingViewerContent />
    </FilingViewerProvider>
  );
}
