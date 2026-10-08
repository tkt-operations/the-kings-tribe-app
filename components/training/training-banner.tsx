/**
 * Full-width "TRAINING ENVIRONMENT" strip, rendered by the root layout only in
 * training mode (lib/training.ts). It sits in the space reserved by the
 * training value of --safe-top (app/globals.css), so it never covers content.
 */
export function TrainingBanner() {
  return (
    <div className="training-banner" role="note" aria-label="Training environment">
      <span>Training environment · fictional data</span>
    </div>
  );
}
