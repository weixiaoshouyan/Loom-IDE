import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    console.error(`[ErrorBoundary: ${this.props.name || 'Unknown'}]`, error, errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 20px',
          color: 'var(--text-primary)',
          fontFamily: "'Segoe UI', system-ui, sans-serif",
          minHeight: '200px',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          margin: '16px',
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: 'var(--red)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: 24, marginBottom: 16,
          }}>!</div>
          <h3 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 600 }}>
            {this.props.name ? `${this.props.name} 组件崩溃` : '组件渲染错误'}
          </h3>
          <p style={{
            margin: '0 0 16px 0', fontSize: 13,
            color: 'var(--text-muted)', textAlign: 'center',
            maxWidth: 500, lineHeight: 1.5,
          }}>
            {this.state.error?.message || '发生了未知错误'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null, errorInfo: null });
            }}
            style={{
              padding: '8px 20px',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            重试
          </button>
          {this.state.errorInfo && (
            <details style={{
              marginTop: 16, width: '100%', maxWidth: 600,
              fontSize: 11, color: 'var(--text-muted)',
            }}>
              <summary style={{ cursor: 'pointer', marginBottom: 8 }}>错误详情</summary>
              <pre style={{
                background: 'var(--bg-secondary)',
                padding: 12, borderRadius: 4,
                overflow: 'auto', maxHeight: 200,
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                fontSize: 11, lineHeight: 1.5,
                margin: 0,
              }}>
                {this.state.error?.stack}
                {'\n\nComponent Stack:'}
                {this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
