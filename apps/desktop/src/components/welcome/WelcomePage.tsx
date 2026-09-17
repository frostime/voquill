import { Box, Button, Stack, Typography, useTheme } from "@mui/material";
import { useEffect } from "react";
import { FormattedMessage } from "react-intl";
import { useNavigate } from "react-router-dom";
import { resetOnboarding } from "../../actions/onboarding.actions";
import { clearGotStartedAt } from "../../actions/user.actions";
import { useAppStore } from "../../store";
import { getShouldGoToOnboarding } from "../../utils/user.utils";
import { Logo } from "../common/Logo";
import { VectorField } from "./VectorField";

export default function WelcomePage() {
  return <StandardWelcomePage />;
}

function StandardWelcomePage() {
  const theme = useTheme();
  const nav = useNavigate();
  const shouldGotoOnboarding = useAppStore(getShouldGoToOnboarding);

  const handleGetStarted = () => {
    resetOnboarding();
    nav("/onboarding");
  };

  useEffect(() => {
    if (shouldGotoOnboarding) {
      nav("/onboarding");
      clearGotStartedAt();
    }
  }, [shouldGotoOnboarding]);

  return (
    <Box
      sx={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <VectorField />
      <Stack
        alignItems="center"
        justifyContent="center"
        sx={{
          position: "relative",
          zIndex: 1,
          minHeight: "100%",
          width: "100%",
          px: 3,
          py: 6,
        }}
      >
        <Stack
          spacing={6}
          alignItems="center"
          textAlign="center"
          sx={{
            maxWidth: 420,
            position: "relative",
            backgroundColor: theme.vars?.palette.background.default,
            boxShadow: `0 0 120px 120px ${theme.vars?.palette.background.default}`,
            borderRadius: 8,
            p: 4,
          }}
        >
          <Stack spacing={2} alignItems="center">
            <Stack direction="row" alignItems="center" spacing={1}>
              <Logo width="4rem" height="4rem" />
              <Typography variant="h3" fontWeight={700}>
                Voquill
              </Typography>
            </Stack>
            <Typography variant="body1" color="text.secondary">
              <FormattedMessage defaultMessage="Voice is your new keyboard." />
            </Typography>
          </Stack>

          <Stack spacing={1.5} width="100%">
            <Button
              variant="contained"
              size="large"
              fullWidth
              onClick={handleGetStarted}
            >
              <FormattedMessage defaultMessage="Get started" />
            </Button>
          </Stack>
        </Stack>
      </Stack>
    </Box>
  );
}
