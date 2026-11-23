update public.baladi_cosmetic_catalog
set asset_path = replace(asset_path, 'frames/', 'assets/frames/')
where kind = 'frame' and asset_path like 'frames/%';
update public.baladi_cosmetic_catalog
set asset_path = replace(asset_path, 'stickers/', 'assets/stickers/')
where kind = 'sticker' and asset_path like 'stickers/%';