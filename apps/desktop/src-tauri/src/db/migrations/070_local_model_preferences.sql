-- Local model storage location and download source preference
ALTER TABLE user_preferences
ADD COLUMN models_dir TEXT;

ALTER TABLE user_preferences
ADD COLUMN model_download_source TEXT;
