# VladCity

Браузерный градостроительный симулятор-мегаполис, где каждый житель — отдельный агент.
Open source, одиночная игра, десктоп и телефоны. Подробности — в [дизайн-документе](docs/GDD.md).

## Статус

**Фаза 1 — технические пробы.** Игры пока нет: на сайте открывается страница бенчмарка, которая
проверяет, потянет ли браузер мегаполис (симуляция агентов в Rust/WASM, рендер Babylon.js,
общая память между потоками, лимиты памяти). Результаты и решения — в [docs/benchmarks.md](docs/benchmarks.md).

## Как прогнать бенчмарк на своём устройстве

1. Открой сайт (см. «Хостинг» ниже) на ноутбуке или телефоне. Подключи зарядку, закрой другие вкладки.
2. Впиши название устройства, например «ноутбук Lenovo» или «iPhone 13».
3. Нажми по очереди тесты 1–4. Тест памяти может перезагрузить вкладку на телефоне — это нормально,
   результат сохранится.
4. Нажми «Отправить в GitHub» → откроется форма задачи с готовой таблицей → «Submit new issue».

## Хостинг

Сайт должен отдавать заголовки `Cross-Origin-Opener-Policy` и `Cross-Origin-Embedder-Policy`,
иначе не работает общая память (SharedArrayBuffer). Они уже прописаны в `client/public/_headers`
(понимают Cloudflare Pages и Netlify). GitHub Pages так не умеет.

CI сам публикует каждую ветку на Cloudflare Pages, когда в репозитории есть два секрета.
Настройка один раз:

1. Зарегистрируйся на [dash.cloudflare.com](https://dash.cloudflare.com) (бесплатно).
2. Скопируй **Account ID** (на главной странице аккаунта, справа).
3. Создай токен: *My Profile → API Tokens → Create Token → шаблон «Edit Cloudflare Workers»*
   (или пустой токен с правом *Account → Cloudflare Pages → Edit*). Скопируй токен.
4. В GitHub: *Settings → Secrets and variables → Actions → New repository secret*:
   `CLOUDFLARE_ACCOUNT_ID` и `CLOUDFLARE_API_TOKEN`.
5. Перезапусти последний запуск CI (*Actions → CI → Re-run all jobs*). Ссылка появится в логе шага
   «Deploy to Cloudflare Pages»: основная ветка — `https://vladcity.pages.dev`, остальные —
   `https://<имя-ветки>.vladcity.pages.dev`.

## Для разработки

Нужны Rust (stable) и Node.js 22.

```bash
./scripts/build-wasm.sh
cd client && npm ci && npm run dev
```

Правила проекта и команды — в [CLAUDE.md](CLAUDE.md).

## Лицензия

Не выбрана (MIT или GPL-3.0 — решение за владельцем проекта, см. фазу 0 в GDD).
