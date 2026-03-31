import { TerminalView } from './components/Terminal';
import { ErrorToastRegion } from './components/ToastProvider';

export default function App() {
  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0a0a14]">
      <TerminalView />
      <ErrorToastRegion />
    </div>
  );
}
