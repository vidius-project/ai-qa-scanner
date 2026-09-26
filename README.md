# Vidius QA Risk Scanner (v0.2)

URL bazlı, otomatik QA ön-keşif aracı. Bir site verirsin; birden fazla sayfayı
gezip konsol hataları, kırık linkler, erişilebilirlik ve mobil sorunları,
form validasyon açıklarını, güvenlik/SEO eksiklerini ve (kanıt değil, sadece
sinyal olarak) bilinen AI/no-code builder izlerini tarayıp ekran görüntülü,
skorlu bir HTML rapor üretir.

## v0.2'de yeni olanlar

- Sadece anasayfa değil, siteden bulunan iç linklerle çoklu sayfa tarama (varsayılan 5 sayfa)
- Masaüstü + mobil ekran görüntüsü (rapora gömülü)
- Gerçek form testi — boş submit deneyip validasyon tetiklendi mi bakıyor
- QA Sağlık Skoru (0-100) ve üstte yönetici özeti — müşteriye ilk gösterdiğin şey
- H1 sayısı, canonical tag, robots.txt, sitemap.xml kontrolleri
- Sayfa yükleme süresi
- **Optimize Edilmemiş Görsel Tespiti** — sayfadaki her görselin gerçek dosya
  boyutunu ölçüyor, 300KB-1MB arası "orta", 1MB üzeri "yüksek öncelik" olarak
  raporluyor. "Şu görsel 2.3MB, bu yüzden siteniz yavaş açılıyor" gibi somut,
  ekranda gösterilebilir bir kanıt.

## Kurulum (ilk sefer)

```bash
cd ai-qa-scanner
npm install
npx playwright install chromium
```

## Kullanım

```bash
node scan.js https://ornek-site.com
```

Sayfa sayısını değiştirmek istersen (varsayılan 5):
```bash
node scan.js https://ornek-site.com --pages=8
```

Rapor `reports/<site-adı>_<tarih>/rapor.html` olarak kaydedilir — ekran
görüntüleriyle aynı klasörde, o yüzden klasörün tamamını (sadece html
dosyasını değil) taşı/paylaş.

## Önemli notlar

- **"AI/No-Code Sinyali" bulguları kanıt değildir.** Sadece Lovable, bolt.new,
  v0.dev, Webflow, Framer AI, Replit Agent gibi araçların bıraktığı bilinen
  kod izlerini arar. Satış konuşmasında bunu "kesin AI yazdı" diye sunma —
  "olası" de. Asıl gücün, konsol hatası / kırık link gibi kanıtlanabilir
  bulgularda.
- Kırık link kontrolü sadece anasayfadaki ilk 25 linke bakıyor (v0.1 kapsamı).
- Form validasyonu şu an otomatik submit denemiyor, sadece form sayısını
  raporluyor — bir sonraki versiyonda genişletilebilir.
- Bazı siteler bot trafiğini engelliyor olabilir; timeout/erişim hatası
  alırsan bu normaldir, o siteyi manuel kontrol et.

## Sıradaki geliştirme fikirleri

- Formlara gerçek boş-submit testi eklemek
- Birden fazla sayfayı (ana menüdeki linkleri) otomatik gezip taramak
- Raporu PDF olarak da çıkarmak (müşteriye e-posta ekinde göndermek için)
- Skor sistemi: bulgulara göre 0-100 "QA Sağlık Skoru" hesaplamak

## Web uygulaması ve Render

Yerelde `npm install`, `npx playwright install chromium`, ardından `npm start` çalıştırın.
Arayüz: http://localhost:3000. Sunucu `process.env.PORT || 3000` portunu
`0.0.0.0` üzerinde dinler.

Render'da bir **Node Web Service** oluşturun:

- **Build Command:** `npm ci && npx playwright install chromium`
- **Start Command:** `npm start`
- **Environment variable:** `PLAYWRIGHT_BROWSERS_PATH=0` (build ve runtime için)

Bu değişken Chromium'u node_modules içindeki Playwright kurulumuna indirir;
build ve çalışma aşamasında aynı tarayıcı dosyaları kullanılır.
Playwright varsayılan headless Chromium ile çalışır. Özel Linux/Docker
ortamında eksik sistem kütüphaneleri varsa, imajın build aşamasında root
yetkisiyle `npx playwright install --with-deps chromium` kullanın.
Kaynak: https://playwright.dev/docs/browsers

Web taraması mevcut `scan.js` dosyasını ayrı Node sürecinde çalıştırır.
`SCAN_REPORT_DIR` yalnızca bu sürece aktarılır; her istek
`reports/<uuid>/rapor.html` ve aynı klasörde desktop/mobile PNG üretir.
Arayüz "Site taranıyor..." durumunu gösterir, durumu sorgular ve hazır
rapora yönlendirir. Hatalar arayüzde gösterilir; ayrıntılar sunucu logundadır.
CLI kullanımı değişmez: `node scan.js <url> [--pages=5]`.

Tek instance kullanın: tarama durumları bellekte, raporlar geçici yerel
filesystem üzerinde tutulur. Yeniden başlatma/deploy sonrasında raporlar
kaybolabilir. Supabase veya kalıcı depolama eklenmemiştir.
`reports/` gitignore kapsamında kalır. Eşzamanlı taramalar ayrı Chromium
süreçleri açtığından instance belleğini buna göre seçin.

