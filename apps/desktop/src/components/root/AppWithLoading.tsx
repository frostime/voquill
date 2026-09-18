import { Box } from "@mui/material";
import Router from "../../router";
import { useAppStore } from "../../store";
import { AppSideEffects } from "./AppSideEffects";
import { AffordancesSideEffects } from "./AffordancesSideEffects";
import { DictationSideEffects } from "./DictationSideEffects";
import { KeyPressSideEffects } from "./KeyPressSideEffects";
import { MigratorSideEffects } from "./MigratorSideEffects";
import { LoadingApp } from "./LoadingApp";

export const AppWithLoading = () => {
  const initialized = useAppStore((state) => state.initialized);
  const hotkeyStrategy = useAppStore((state) => state.hotkeyStrategy);

  return (
    <>
      {hotkeyStrategy === "bridge" && <KeyPressSideEffects />}
      <AppSideEffects />
      <MigratorSideEffects />
      <DictationSideEffects />
      <AffordancesSideEffects />
      <Box sx={{ height: "100vh", width: "100vw", overflow: "hidden" }}>
        {initialized ? <Router /> : <LoadingApp />}
      </Box>
    </>
  );
};
