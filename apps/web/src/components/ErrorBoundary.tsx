import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled render error", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-5xl px-6 py-8">
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-4">
              <span>Something went wrong rendering this page.</span>
              <Button type="button" variant="outline" size="sm" onClick={() => this.setState({ error: null })}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      );
    }
    return this.props.children;
  }
}
