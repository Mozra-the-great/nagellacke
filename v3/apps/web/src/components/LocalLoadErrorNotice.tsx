import { useEffect } from 'react';
import { useSnackbar } from './Snackbar';

/**
 * Fires a one-time snackbar when the app's locally cached collection data
 * failed to load (see loadLocal() in useAppData.ts / #258) — otherwise the
 * user just sees an empty collection with no indication anything went wrong.
 * Must be rendered inside <SnackbarProvider>; `show` is a snapshot from the
 * initial load, so this only ever fires once per mount.
 */
export default function LocalLoadErrorNotice({ show }: { show: boolean }) {
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    if (show) {
      showSnackbar('Lokale Daten konnten nicht geladen werden — möglicherweise beschädigt');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  return null;
}
