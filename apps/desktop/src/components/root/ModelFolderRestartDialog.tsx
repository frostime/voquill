import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import { relaunch } from "@tauri-apps/plugin-process";
import { FormattedMessage } from "react-intl";
import { showErrorSnackbar } from "../../actions/app.actions";
import { useAppStore } from "../../store";

export const ModelFolderRestartDialog = () => {
  const status = useAppStore(
    (state) => state.settings.aiTranscription.modelsDirChangeStatus,
  );

  return (
    <Dialog open={status !== null} disableEscapeKeyDown maxWidth="xs" fullWidth>
      <DialogTitle>
        <FormattedMessage defaultMessage="Restarting Voquill" />
      </DialogTitle>
      <DialogContent>
        <DialogContentText>
          {status === "saving" ? (
            <FormattedMessage defaultMessage="Saving the model folder. Voquill will restart when it is saved." />
          ) : (
            <FormattedMessage defaultMessage="Voquill must restart before you can continue with the new model folder." />
          )}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button
          variant="contained"
          disabled={status === "saving"}
          onClick={() => {
            void relaunch().catch((error) => {
              showErrorSnackbar(
                error instanceof Error ? error.message : String(error),
              );
            });
          }}
        >
          <FormattedMessage defaultMessage="Restart Voquill" />
        </Button>
      </DialogActions>
    </Dialog>
  );
};
