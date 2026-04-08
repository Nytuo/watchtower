import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAnalyticsStore } from "@/lib/analytics";

export function AnalyticsDialog() {
  const decided = useAnalyticsStore((s) => s.decided);
  const setConsent = useAnalyticsStore((s) => s.setConsent);
  const [usage, setUsage] = useState(false);
  const [errors, setErrors] = useState(false);

  if (decided) return null;

  return (
    <Dialog open onClose={() => setConsent(false, false)} className="max-w-md">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Help improve Watchtower?</DialogTitle>
          <DialogDescription>
            Both options are off by default. You can change this any time in
            Settings.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={usage}
              onCheckedChange={(c) => setUsage(c === true)}
            />
            <span>
              <span className="font-medium">Anonymous usage counts</span>
              <span className="block text-muted-foreground">
                Which features and protocols get used. No hostnames,
                credentials or commands.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={errors}
              onCheckedChange={(c) => setErrors(c === true)}
            />
            <span>
              <span className="font-medium">Automatic bug reports</span>
              <span className="block text-muted-foreground">
                Error messages when the app crashes, with IPs, hostnames and
                paths stripped.
              </span>
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            Sent to our self-hosted analytics (analytics.nytuo.fr, Aptabase).
            No IP address or persistent ID is stored.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConsent(false, false)}>
            No thanks
          </Button>
          <Button onClick={() => setConsent(usage, errors)}>Save choice</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
