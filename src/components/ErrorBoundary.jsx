import { Component } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-[#000000] flex items-center justify-center p-6">
          <div className="text-center max-w-md">
            <AlertTriangle className="w-12 h-12 text-[#FFC107] mx-auto mb-4" />
            <h2 className="text-lg font-bold text-white mb-2">Erro inesperado</h2>
            <p className="text-sm text-[#a0a0a0] mb-6">{this.state.error?.message || 'Ocorreu um erro na renderização.'}</p>
            <Button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="bg-[#FFC107] hover:bg-[#FFD54F] text-black rounded-xl"
            >
              Tentar novamente
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}