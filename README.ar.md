<p align="left">
  <a href="./README.md"><img src="./docs/images/language-en.png" alt="English" width="124"></a>
</p>

<div dir="rtl" lang="ar">

# X Cleaner

إضافة لتنظيف منشوراتك وردودك وإعادات نشرك وعلاماتك المرجعية وإعجاباتك على X. تتعرّف على الحساب المسجّل دخوله وتعرض اسم المستخدم قبل بدء التنظيف.

[![اضغط للتحميل](./docs/images/download-ar.png)](./X-Cleaner-1.4.0.zip?raw=true)

**الإصدار 1.4.0 · ملف ZIP · تثبيت يدوي على متصفحات Chromium المكتبية**

## التثبيت والتشغيل

الصور التالية محاكاة مشروحة لواجهتَي ويندوز وChrome. قد يختلف ترتيب الأزرار حسب المتصفح ونظام التشغيل.

### ١. فك ضغط الملف

على ويندوز، اضغط بالزر الأيمن على `X-Cleaner-1.4.0.zip` واختر **استخراج الكل** (**Extract All…**) ثم اضغط **استخراج**. على macOS، انقر مرتين على الملف. على لينكس، استخدم مدير الأرشيف لفك الضغط.

![مستكشف الملفات مع سهم يشير إلى خيار استخراج الكل](./docs/images/01-extract.png)

### ٢. فعّل وضع المطوّر

في Chrome، اكتب `chrome://extensions` في شريط العنوان واضغط Enter. فعّل **وضع المطوّر** (**Developer mode**) عند السهم 1، ثم اضغط **تحميل إضافة غير مضغوطة** (**Load unpacked**) عند السهم 2. لعناوين المتصفحات الأخرى، شوف الجدول بالأسفل.

![صفحة الإضافات في Chrome مع سهمين إلى وضع المطوّر وتحميل إضافة غير مضغوطة](./docs/images/02-developer-mode.png)

### ٣. اختر المجلد بعد فك الضغط

افتح مجلد `X-Cleaner-1.4.0` الناتج عن فك الضغط. تأكّد من وجود `manifest.json` مباشرةً داخله عند السهم 1، ثم اضغط **تحديد المجلد** (**Select Folder**) عند السهم 2. نافذة الاختيار قد تخفي الملفات لأنها تطلب مجلداً. إذا حمّلت الكود من **Code → Download ZIP**، اختر مجلد `extension` الموجود داخل مجلد المستودع بعد فك الضغط.

![مثال يوضّح مكان ملف manifest.json وزر تحديد المجلد](./docs/images/03-select-folder.png)

### ٤. شغّل الإضافة من تبويب X

1. سجّل دخولك في [x.com](https://x.com). من نفس التبويب افتح **الإضافات → X Cleaner** عند السهم 1. فيك تثبّتها على شريط المتصفح للوصول السريع.
2. تأكّد أن اسم المستخدم المعروض هو حسابك عند السهم 2، وحدّد أنواع النشاط التي تريد تنظيفها.
3. اضغط **Preview route** عند السهم 3 للمعاينة بدون حذف.
4. اضغط **Clean selected** أو **Clean everything** عند السهم 4 لبدء التنظيف. الحذف دائم. خلّي تبويب التنظيف مفتوح، واستخدم **Stop cleanup** إذا بدك توقف العملية.

![محاكاة لواجهة X Cleaner مع أسهم إلى قائمة الإضافات والحساب والمعاينة وزر التنظيف](./docs/images/04-use.png)

## توافق المتصفحات

| المتصفح | مكان التثبيت |
| --- | --- |
| Chrome وChromium | `chrome://extensions` ثم **Developer mode → Load unpacked**. ملف الإضافة يتطلب Chrome 120 أو أحدث. |
| Microsoft Edge | `edge://extensions` ثم **Developer mode → Load unpacked**. |
| Brave | `brave://extensions` ثم **Developer mode → Load unpacked**. |
| Vivaldi | قائمة Vivaldi ثم **Tools → Extensions**، وبعدها **Developer mode → Load unpacked**. |
| Opera وOpera GX | `opera:extensions` ثم **Developer mode → Load unpacked**. |
| Firefox وSafari ومتصفحات الجوال | ملف ZIP مخصّص لمتصفحات Chromium المكتبية. هذه المتصفحات خارج نطاق الإصدار الحالي. |

تم التحقق من حزمة التثبيت باستخدام Chromium. توافق الإضافة مع كل متصفح وإصدار في القائمة لم يُختبر على حدة. Firefox يتطلّب إعداداً مختلفاً لعمل الإضافة بالخلفية في Manifest V3، وSafari يتطلّب تغليفاً خاصاً. راجع وثائق [Chrome](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world) و[Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading) و[Brave](https://support.brave.app/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave) و[Vivaldi](https://help.vivaldi.com/desktop/appearance-customization/extensions/) و[Opera](https://help.opera.com/en/extensions/testing/) و[Firefox](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background) و[Safari](https://developer.apple.com/safari/extensions/).

## حل المشاكل الشائعة

- **ملف manifest غير موجود أو غير قابل للقراءة** — افتح المجلد في مدير الملفات وتأكّد أن `manifest.json` موجود مباشرةً داخله، ثم اختر المجلد نفسه.
- **الحساب غير ظاهر** — سجّل دخولك في `x.com`، حدّث الصفحة وافتح X Cleaner من نفس التبويب.
- **التنظيف توقّف مؤقتاً** — اقرأ السبب في واجهة الإضافة. طلب تسجيل الدخول أو تبديل الحساب أو بلوغ حدّ الطلبات ممكن يوقف العملية مؤقتاً.

## الخصوصية والقيود

تقرأ الإضافة اسم المستخدم من الصفحة وتحفظ تقدم العملية ونتائجها محلياً في المتصفح. ما بتجمع بيانات الدخول أو ملفات تعريف الارتباط أو بيانات التحليلات، وما بترسل تقارير لخدمات خارجية. التنظيف يشمل العناصر التي يعرضها X في واجهته. [قواعد الأتمتة على X](https://help.x.com/en/rules-and-policies/x-automation) تحظر الأتمتة خارج واجهة API، وقد تفرض المنصة قيوداً على الحساب.

## الاختبارات

من جذر المستودع، شغّل الاختبارات باستخدام Node.js. الاختبارات تحاكي صفحات X وواجهات برمجة إضافات المتصفح.

```sh
node tests/test-worker.cjs
node tests/test-content.cjs
node tests/test-popup.cjs
```

</div>
