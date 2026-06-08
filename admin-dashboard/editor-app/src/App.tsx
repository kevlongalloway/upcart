import React, { useEffect } from 'react';
import { useEditor } from './store';
import TopBar from './TopBar';
import LeftPanel from './LeftPanel';
import Canvas from './Canvas';
import RightPanel from './RightPanel';
import Tutorial from './Tutorial';

export default function App() {
  const loadSchema = useEditor(s => s.loadSchema);
  const isLoading  = useEditor(s => s.isLoading);
  const loadError  = useEditor(s => s.loadError);

  useEffect(() => {
    loadSchema();
  }, [loadSchema]);

  return (
    <div className="flex flex-col h-full bg-ed-bg">
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <LeftPanel />
        <main className="flex-1 min-w-0 flex flex-col items-center justify-start bg-ed-bg overflow-hidden relative">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center z-50">
              <div className="flex flex-col items-center gap-3 text-ed-muted">
                <div className="w-6 h-6 border-2 border-ed-accent border-t-transparent rounded-full animate-spin" />
                <span className="text-xs">Loading schema…</span>
              </div>
            </div>
          )}
          {loadError && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-900/80 text-red-200 text-xs px-4 py-2 rounded-lg">
              {loadError}
            </div>
          )}
          {!isLoading && <Canvas />}
        </main>
        <RightPanel />
      </div>
      <Tutorial />
    </div>
  );
}
