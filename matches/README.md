## API

### /preferences
Єдиний ендпоінт для читання/запису преференсів користувача:
- `GET /.netlify/functions/preferences`
- `POST /.netlify/functions/preferences` (X-CSRF обов’язковий)

Детальніше: див. `docs/api/preferences.md`.

### Legacy (sunset)
Наступні ендпоінти повертають `410 Gone` і не повинні використовуватись:
- `/.netlify/functions/getSort`
- `/.netlify/functions/setSort`
- `/.netlify/functions/setSeenColor`

Детальніше: `docs/legacy-sort-sunset.md`.
## API

### /preferences
Єдиний ендпоінт для читання/запису преференсів користувача:
- GET /.netlify/functions/preferences
- POST /.netlify/functions/preferences (X-CSRF обовязковий)

Детальніше: див. docs/api/preferences.md.

### Legacy (sunset)
Наступні ендпоінти повертають 410 Gone і не повинні використовуватись:
- /.netlify/functions/getSort
- /.netlify/functions/setSort
- /.netlify/functions/setSeenColor

Детальніше: docs/legacy-sort-sunset.md.
