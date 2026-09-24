import { Box, Button, TextField } from "@mui/material";
import { useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";

type Props = {
  value: Record<string, unknown> | null | undefined;
  disabled: boolean;
  onSave: (value: Record<string, unknown> | null) => Promise<void>;
};

export const PostProcessingRequestOptionsField = ({
  value,
  disabled,
  onSave,
}: Props) => {
  const [text, setText] = useState(() =>
    value ? JSON.stringify(value, null, 2) : "",
  );
  const [error, setError] = useState<
    "invalid-json" | "not-object" | "save-failed" | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty) return;
    setText(value ? JSON.stringify(value, null, 2) : "");
    setError(null);
  }, [dirty, value]);

  const handleSave = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setError(null);
      setSaving(true);
      try {
        await onSave(null);
        setDirty(false);
      } catch {
        setError("save-failed");
      } finally {
        setSaving(false);
      }
      return;
    }

    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        setError("not-object");
        return;
      }
      setError(null);
      setSaving(true);
      try {
        await onSave(parsed as Record<string, unknown>);
        setDirty(false);
      } catch {
        setError("save-failed");
      } finally {
        setSaving(false);
      }
    } catch {
      setError("invalid-json");
    }
  };

  return (
    <Box onClick={(event) => event.stopPropagation()}>
      <TextField
        label={
          <FormattedMessage defaultMessage="Post-processing request options" />
        }
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setDirty(true);
          setError(null);
        }}
        placeholder={'{\n  "reasoning_effort": "low"\n}'}
        multiline
        minRows={4}
        fullWidth
        size="small"
        disabled={disabled || saving}
        error={error !== null}
        helperText={
          error === "invalid-json" ? (
            <FormattedMessage defaultMessage="Invalid JSON." />
          ) : error === "not-object" ? (
            <FormattedMessage defaultMessage="Options must be a JSON object." />
          ) : error === "save-failed" ? (
            <FormattedMessage defaultMessage="Failed to save options." />
          ) : (
            <FormattedMessage defaultMessage="Optional provider-specific JSON object used only for post-processing." />
          )
        }
      />
      <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
        <Button
          size="small"
          variant="outlined"
          onClick={() => void handleSave()}
          disabled={disabled || saving}
        >
          {saving ? (
            <FormattedMessage defaultMessage="Saving..." />
          ) : (
            <FormattedMessage defaultMessage="Save options" />
          )}
        </Button>
      </Box>
    </Box>
  );
};
