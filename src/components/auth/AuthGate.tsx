import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Loader2 } from 'lucide-react';

function LoginScreen() {
  const signIn = useAuth((s) => s.signIn);
  const requestPasswordRecovery = useAuth((s) => s.requestPasswordRecovery);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const message = await signIn(email, password);
    if (message) {
      setError(message);
      setSubmitting(false);
    }
    // On success the auth listener swaps this screen out, so no state reset needed.
  };

  const handlePasswordRecovery = async () => {
    if (!email) {
      setError('Enter your email address first.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const message = await requestPasswordRecovery(email);
    setSubmitting(false);
    if (message) {
      setError(message);
      return;
    }
    setRecoverySent(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Your invoices are private. Sign in to view them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign in
            </Button>
            <Button type="button" variant="link" className="w-full" disabled={submitting} onClick={handlePasswordRecovery}>
              Forgot password?
            </Button>
            {recoverySent && (
              <Alert>
                <AlertDescription>Check your email for a password-reset link.</AlertDescription>
              </Alert>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function PasswordRecoveryScreen() {
  const updatePassword = useAuth((s) => s.updatePassword);
  const finishPasswordRecovery = useAuth((s) => s.finishPasswordRecovery);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirmation) return setError('The passwords do not match.');
    setSubmitting(true);
    setError(null);
    const message = await updatePassword(password);
    if (message) {
      setError(message);
      setSubmitting(false);
      return;
    }
    finishPasswordRecovery();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Set a new password</CardTitle>
          <CardDescription>Your recovery link is valid for this browser session only.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input id="new-password" type="password" autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input id="confirm-password" type="password" autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
            </div>
            {error && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { session, initialized, passwordRecovery, init } = useAuth();

  useEffect(() => {
    init();
  }, [init]);

  if (!initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (session && passwordRecovery) return <PasswordRecoveryScreen />;
  return session ? <>{children}</> : <LoginScreen />;
}
