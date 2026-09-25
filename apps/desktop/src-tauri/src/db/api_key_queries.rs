use sqlx::{Row, SqlitePool};

use crate::domain::{ApiKey, ApiKeyUpdateRequest};

pub async fn insert_api_key(pool: SqlitePool, api_key: &ApiKey) -> Result<ApiKey, sqlx::Error> {
    sqlx::query(
        "INSERT INTO api_keys (id, name, provider, created_at, salt, key_hash, key_ciphertext, key_suffix, transcription_model, post_processing_model, post_processing_options, openrouter_config, base_url, azure_region, include_v1_path)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
    )
    .bind(&api_key.id)
    .bind(&api_key.name)
    .bind(&api_key.provider)
    .bind(api_key.created_at)
    .bind(&api_key.salt)
    .bind(&api_key.key_hash)
    .bind(&api_key.key_ciphertext)
    .bind(&api_key.key_suffix)
    .bind(&api_key.transcription_model)
    .bind(&api_key.post_processing_model)
    .bind(&api_key.post_processing_options)
    .bind(&api_key.openrouter_config)
    .bind(&api_key.base_url)
    .bind(&api_key.azure_region)
    .bind(api_key.include_v1_path)
    .execute(&pool)
    .await?;

    Ok(api_key.clone())
}

pub async fn fetch_api_keys(pool: SqlitePool) -> Result<Vec<ApiKey>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, name, provider, created_at, salt, key_hash, key_ciphertext, key_suffix, transcription_model, post_processing_model, post_processing_options, openrouter_config, base_url, azure_region, include_v1_path
         FROM api_keys
         ORDER BY created_at DESC",
    )
    .fetch_all(&pool)
    .await?;

    let api_keys = rows
        .into_iter()
        .map(|row| ApiKey {
            id: row.get::<String, _>("id"),
            name: row.get::<String, _>("name"),
            provider: row.get::<String, _>("provider"),
            created_at: row.get::<i64, _>("created_at"),
            salt: row.get::<String, _>("salt"),
            key_hash: row.get::<String, _>("key_hash"),
            key_ciphertext: row.get::<String, _>("key_ciphertext"),
            key_suffix: row.get::<Option<String>, _>("key_suffix"),
            transcription_model: row.get::<Option<String>, _>("transcription_model"),
            post_processing_model: row.get::<Option<String>, _>("post_processing_model"),
            post_processing_options: row.get::<Option<String>, _>("post_processing_options"),
            openrouter_config: row.get::<Option<String>, _>("openrouter_config"),
            base_url: row.get::<Option<String>, _>("base_url"),
            azure_region: row.get::<Option<String>, _>("azure_region"),
            include_v1_path: row.get::<Option<bool>, _>("include_v1_path"),
        })
        .collect();

    Ok(api_keys)
}

pub async fn update_api_key(
    pool: SqlitePool,
    request: &ApiKeyUpdateRequest,
    salt: Option<&str>,
    key_hash: Option<&str>,
    key_ciphertext: Option<&str>,
    key_suffix: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE api_keys SET
            name = CASE WHEN ?2 IS NOT NULL THEN ?2 ELSE name END,
            salt = CASE WHEN ?3 IS NOT NULL THEN ?3 ELSE salt END,
            key_hash = CASE WHEN ?4 IS NOT NULL THEN ?4 ELSE key_hash END,
            key_ciphertext = CASE WHEN ?5 IS NOT NULL THEN ?5 ELSE key_ciphertext END,
            key_suffix = CASE WHEN ?6 IS NOT NULL THEN ?6 ELSE key_suffix END,
            transcription_model = CASE WHEN ?7 IS NOT NULL THEN ?7 ELSE transcription_model END,
            post_processing_model = CASE WHEN ?8 IS NOT NULL THEN ?8 ELSE post_processing_model END,
            post_processing_options = CASE
                WHEN ?10 = 1 THEN NULL
                WHEN ?9 IS NOT NULL THEN ?9
                ELSE post_processing_options
            END,
            openrouter_config = CASE WHEN ?11 IS NOT NULL THEN ?11 ELSE openrouter_config END,
            base_url = CASE WHEN ?12 IS NOT NULL THEN ?12 ELSE base_url END,
            azure_region = CASE WHEN ?13 IS NOT NULL THEN ?13 ELSE azure_region END,
            include_v1_path = CASE WHEN ?14 IS NOT NULL THEN ?14 ELSE include_v1_path END
         WHERE id = ?1",
    )
    .bind(&request.id)
    .bind(&request.name)
    .bind(salt)
    .bind(key_hash)
    .bind(key_ciphertext)
    .bind(key_suffix)
    .bind(&request.transcription_model)
    .bind(&request.post_processing_model)
    .bind(&request.post_processing_options)
    .bind(request.clear_post_processing_options)
    .bind(&request.openrouter_config)
    .bind(&request.base_url)
    .bind(&request.azure_region)
    .bind(request.include_v1_path)
    .execute(&pool)
    .await?;

    Ok(())
}

pub async fn delete_api_key(pool: SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM api_keys
         WHERE id = ?1",
    )
    .bind(id)
    .execute(&pool)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[test]
    fn post_processing_options_can_be_set_retained_and_cleared() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();

            for migration in crate::db::migrations() {
                if matches!(migration.kind, tauri_plugin_sql::MigrationKind::Up) {
                    sqlx::raw_sql(migration.sql).execute(&pool).await.unwrap();
                }
            }

            let api_key = ApiKey {
                id: "test-key".into(),
                name: "Test".into(),
                provider: "openai".into(),
                created_at: 1,
                salt: "salt".into(),
                key_hash: "hash".into(),
                key_ciphertext: "ciphertext".into(),
                key_suffix: None,
                transcription_model: None,
                post_processing_model: None,
                post_processing_options: None,
                openrouter_config: None,
                base_url: None,
                azure_region: None,
                include_v1_path: None,
            };
            insert_api_key(pool.clone(), &api_key).await.unwrap();
            assert_eq!(
                fetch_api_keys(pool.clone()).await.unwrap()[0].post_processing_options,
                None
            );

            let mut request = ApiKeyUpdateRequest {
                id: api_key.id.clone(),
                name: None,
                key: None,
                transcription_model: None,
                post_processing_model: None,
                post_processing_options: Some(r#"{"thinking":{"level":"low"}}"#.into()),
                clear_post_processing_options: false,
                openrouter_config: None,
                base_url: None,
                azure_region: None,
                include_v1_path: None,
            };
            update_api_key(pool.clone(), &request, None, None, None, None)
                .await
                .unwrap();
            let saved = fetch_api_keys(pool.clone()).await.unwrap();
            assert_eq!(
                saved[0].post_processing_options,
                request.post_processing_options
            );

            request.post_processing_options = None;
            update_api_key(pool.clone(), &request, None, None, None, None)
                .await
                .unwrap();
            let retained = fetch_api_keys(pool.clone()).await.unwrap();
            assert_eq!(
                retained[0].post_processing_options,
                saved[0].post_processing_options
            );

            request.clear_post_processing_options = true;
            update_api_key(pool.clone(), &request, None, None, None, None)
                .await
                .unwrap();
            assert_eq!(
                fetch_api_keys(pool).await.unwrap()[0].post_processing_options,
                None
            );
        });
    }
}
