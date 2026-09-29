"""Labelled evaluation set for review-text moderation (M9, Phase 3 Part 4 §3).

Writes packages/edge-tests/eval/moderation-set.json. Each item has the decision our policy expects:
  approve           honest opinions, including harsh criticism of the service
  approve_redacted  fine, but contains contact details (phone, email, handle) that must be removed
  reject            threats, hate, sexual harassment, spam / advertising
  manual_review     insults aimed at an identifiable person, or unclear cases a human should read
Languages: en, ar (Lebanese + MSA), fr, arabizi, mixed. Team first names in context: Karim, Rita, Maya, Joe.
Invented examples written for this set; no real people or businesses.
Run: python scripts/moderation-eval-set.py
"""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PEOPLE = ['Karim', 'Rita', 'Maya', 'Joe']

S = {}  # category -> (expected decision, [(lang, text)])

S['positive'] = ('approve', [
    ('en', 'Best fade I have had in Beirut. Karim takes his time and the place is spotless.'),
    ('en', 'Booked online in a minute, they were on time and the result was exactly what I asked for.'),
    ('en', 'Rita did my nails and they lasted three weeks. Friendly team, fair prices.'),
    ('en', 'Great massage, very relaxing room and the music was just right. Will come back.'),
    ('en', 'Clean, quick and professional. My son loved his first haircut here.'),
    ('en', 'Maya is amazing with curly hair, finally someone who understands it!'),
    ('en', 'Honestly the nicest salon staff in Hamra. Coffee while you wait is a nice touch.'),
    ('en', 'Perfect beard trim, hot towel, no rush. Worth every dollar.'),
    ('en', 'I was nervous about laser but Joe explained everything and it barely hurt.'),
    ('en', 'Parking was easy and the booking reminder on WhatsApp was really helpful.'),
    ('ar', 'أفضل حلاق جربته، كريم محترف جدًا والمكان نظيف.'),
    ('ar', 'الخدمة ممتازة والموظفين لطيفين، بنصح فيه كتير.'),
    ('ar', 'ريتا عملتلي أظافري وطلعوا كتير حلوين، شكرًا إلكن.'),
    ('ar', 'مكان مرتب وهادي، والأسعار منطقية. رح إرجع أكيد.'),
    ('ar', 'التزموا بالموعد تمامًا والنتيجة أحلى من ما توقعت.'),
    ('ar', 'تجربة رائعة، مايا فهمت شو بدي من أول مرة.'),
    ('ar', 'نظافة عالية وتعقيم للأدوات قدامي، هيدا الشي بطمن.'),
    ('ar', 'قصة شعر ممتازة وسرعة بالخدمة، يعطيكن العافية.'),
    ('ar', 'جلسة المساج كانت مريحة جدًا، أنصح فيها لكل حدا تعبان.'),
    ('ar', 'خدمة زبائن محترمة والحجز عبر التطبيق سهل كتير.'),
    ('fr', 'Très bon service, accueil chaleureux et coupe parfaite. Merci Karim !'),
    ('fr', 'Salon propre, personnel souriant, je recommande vivement.'),
    ('fr', 'Super manucure, Rita est très minutieuse. Je reviendrai.'),
    ('fr', 'Rendez-vous respecté à la minute près, résultat impeccable.'),
    ('fr', 'Ambiance agréable et prix corrects pour la qualité.'),
    ('fr', 'Massage génial, je me suis presque endormie. Bravo à l’équipe.'),
    ('fr', 'Première visite et certainement pas la dernière, merci beaucoup.'),
    ('arabizi', 'Ktir 7elo el sha3er, Karim ma3o 7a2, akid ra7 erja3.'),
    ('arabizi', 'Mni7 ktir, nedif w el staff zaki. Tamem!'),
    ('arabizi', 'Rita 3amaletle manicure ra2e3a, merci ktir.'),
    ('arabizi', 'El massage kan 3ajib, ahla jalse ma3mulle mn zaman.'),
    ('arabizi', 'Wallah a7la 7ala2 b beirut, sa7 el wa2et w bala tawle.'),
    ('arabizi', 'Maya fehmet shu badde mn awal marra, 7elo ktir el natije.'),
    ('arabizi', 'Mafi aktar mn hek, service mni7 w as3ar ma32oule.'),
    ('arabizi', 'Joe shra7le kel shi abl el laser, ktir mertele.'),
    ('mixed', 'The haircut was ممتاز جدا and super quick, merci!'),
    ('mixed', 'Service top, كتير نظيف, and Karim is a legend.'),
    ('mixed', 'Ktir 7elo, very professional, je recommande.'),
    ('mixed', 'أحلى صالون, the staff are so kind w el as3ar mni7a.'),
    ('mixed', 'Rita is the best, كتير دقيقة بشغلها, merci!'),
    ('mixed', 'Top service, ma fi a7la, will book again.'),
    ('mixed', 'Nails were perfect, رح إرجع أكيد, merci beaucoup.'),
    ('en', 'Five stars. Nothing to add, just great work.'),
    ('ar', 'خمس نجوم عن جدارة.'),
    ('fr', 'Parfait du début à la fin.'),
])

S['negative_service'] = ('approve', [
    ('en', 'Waited 40 minutes past my booking time and nobody apologised. Not coming back.'),
    ('en', 'The fade was uneven on the left side and they rushed the finish.'),
    ('en', 'Way too expensive for a basic trim. 30 dollars for ten minutes is a joke.'),
    ('en', 'The towels smelled damp and the floor had hair everywhere. Hygiene needs work.'),
    ('en', 'Worst haircut I have ever had, total waste of money.'),
    ('en', 'They cancelled on me an hour before, second time this month.'),
    ('en', 'Colour came out orange instead of ash blonde. Very disappointed.'),
    ('en', 'Music was so loud I could not talk to the stylist about what I wanted.'),
    ('en', 'The massage was fine but the room was freezing and nobody offered a blanket.'),
    ('en', 'Booking said 3pm, they only started at 3:45. Please respect people’s time.'),
    ('en', 'Karim was nice but the cut itself was average, nothing special for the price.'),
    ('en', 'Laser session was painful and the result after four sessions is barely visible.'),
    ('en', 'Honestly terrible experience from start to finish, avoid.'),
    ('ar', 'استنيت أكتر من نص ساعة بعد موعدي وما حدا اعتذر.'),
    ('ar', 'القصة طلعت مش متساوية والشغل كان مستعجل.'),
    ('ar', 'الأسعار غالية كتير مقارنة بالخدمة.'),
    ('ar', 'المكان مش نظيف والمناشف ريحتها مش طيبة.'),
    ('ar', 'أسوأ تجربة، ما رح إرجع أبدًا.'),
    ('ar', 'لغوا موعدي قبل ساعة بدون سبب واضح.'),
    ('ar', 'اللون طلع غير يلي طلبته تمامًا، خيبة أمل.'),
    ('ar', 'الموظفة كانت عم تحكي عالتلفون طول الوقت وما ركزت بشغلها.'),
    ('ar', 'الخدمة عادية جدًا وما بتستاهل هالسعر.'),
    ('ar', 'التكييف كان معطل والجو حر كتير جوا.'),
    ('fr', 'Attente de 45 minutes malgré le rendez-vous, inacceptable.'),
    ('fr', 'Coupe ratée, trop courte sur les côtés. Déçu.'),
    ('fr', 'Beaucoup trop cher pour ce que c’est.'),
    ('fr', 'Salon sale et serviettes humides, hygiène à revoir.'),
    ('fr', 'Accueil froid et personnel pressé, je ne reviendrai pas.'),
    ('fr', 'Le résultat de la couleur est loin de ce que j’avais demandé.'),
    ('arabizi', 'Stanet nos se3a ba3d el maw3ad w ma 7ada e3tazar.'),
    ('arabizi', 'El 2assa tel3et mech mni7a, mesta3jlin ktir.'),
    ('arabizi', 'Ghale ktir 3a hal shi, mech 7erze.'),
    ('arabizi', 'El mahal mech nedif w el mnashef ri7eton 5ara.'),
    ('arabizi', 'Awwal w a5er marra, ma ra7 erja3.'),
    ('arabizi', 'Lagho maw3ade abl se3a, mesh ma32ool.'),
    ('arabizi', 'El lon tele3 ghalat, mesh yalli tlabto.'),
    ('mixed', 'Waited forever, ما حدا اعتذر, not acceptable.'),
    ('mixed', 'Trop cher, الخدمة عادية, not worth it.'),
    ('mixed', 'The place was dirty, el mnashef ri7eton 5ara.'),
    ('mixed', 'Service ktir ba6i2, 45 minutes late, bof.'),
    ('mixed', 'Colour was wrong, خيبة أمل, je suis déçue.'),
    ('mixed', 'Cut was ok bas ghale ktir for what it is.'),
    ('en', 'Two stars because the receptionist was kind, the rest was a mess.'),
    ('ar', 'نجمتين بس لأن الاستقبال كان منيح.'),
    ('en', 'The shampoo burned my scalp and nobody checked if I was ok.'),
])

S['pii'] = ('approve_redacted', [
    ('en', 'Lovely service! If anyone wants details call me on 71 123 456.'),
    ('en', 'Great cut, message me at 03 456 789 if you want the stylist’s schedule.'),
    ('en', 'Really happy with the result, email me lina.test@example.com for photos.'),
    ('en', 'Nails were perfect, follow my page @lina_nails_lb for pictures of the design.'),
    ('en', 'Best barber, ask me anything on +961 76 555 123.'),
    ('en', 'Good massage. You can reach me at 00961 70 888 999 if you want a recommendation.'),
    ('en', 'Clean and friendly. My number is 81 222 333 for anyone asking.'),
    ('ar', 'خدمة ممتازة، اللي بدو تفاصيل يتصل على 71123456.'),
    ('ar', 'القصة حلوة كتير، راسلوني على ٧٠ ١٢٣ ٤٥٦ للاستفسار.'),
    ('ar', 'مكان نظيف، رقمي ٠٣ ٤٥٦ ٧٨٩ إذا حدا بدو يسأل.'),
    ('ar', 'تجربة حلوة، تابعوا صفحتي @rana.beauty.lb.'),
    ('ar', 'الموظفين لطاف، ابعتولي على rana.test@example.com للصور.'),
    ('ar', 'شغل نظيف، اتصلوا على +961 3 123 456 إذا بدكن رأيي.'),
    ('fr', 'Service impeccable, appelez-moi au 76 123 456 pour plus d’infos.'),
    ('fr', 'Très bien, écrivez-moi à marc.test@example.com si besoin.'),
    ('fr', 'Belle coupe, suivez @marc_style_lb pour voir le résultat.'),
    ('arabizi', 'Ktir 7elo, eza badkon tafasil 7ekoune 3a 71 999 888.'),
    ('arabizi', 'Mni7 el service, ra2me 70 444 555 eza 7ada baddo yes2al.'),
    ('arabizi', 'Rita ra2e3a, follow @rita_fan_page_lb.'),
    ('mixed', 'Great service, راسلوني على 71 321 654 for photos.'),
    ('mixed', 'Top coupe, ra2me 03 111 222, merci!'),
    ('mixed', 'Nails 7elwin ktir, check @nailart.beirut for the design.'),
    ('en', 'Great place. Paid 1.500.000 LBP for the color, call 70 123 456 for the stylist.'),
    ('en', 'Very clean, call ٧١ ٥٥٥ ٦٦٦ if you have questions.'),
])

S['spam'] = ('reject', [
    ('en', 'Best prices in town! Visit our page www.cheap-cuts-lb.com and use code SAVE20.'),
    ('en', 'Order now at bit.ly/beauty-deal, free delivery all over Lebanon, dm me.'),
    ('en', 'Click here for free followers: www.boostlikes.com, dm me for promo code.'),
    ('en', 'Visit our salon instead, better and cheaper, follow us at www.othersalon.me.'),
    ('en', 'Crypto investment 300% returns, contact me on t.me/fastprofit.'),
    ('en', 'Use discount code GLOW10 at www.glowshop.store for 10% off all products.'),
    ('ar', 'أفضل الأسعار! زوروا موقعنا www.aroud-lb.com واستعملوا كود خصم.'),
    ('ar', 'اطلب الآن من www.beautyshop.lb، توصيل مجاني، تابعونا.'),
    ('ar', 'اضغط هنا لمتابعين مجانًا: www.followers-free.com'),
    ('ar', 'تعالوا لعنا أحسن وأرخص، تابعونا على www.salon-tany.com'),
    ('fr', 'Meilleurs prix ! Visitez www.promo-coiffure.com avec le code promo PROMO15.'),
    ('fr', 'Cliquez ici pour gagner un iPhone: bit.ly/cadeau-lb'),
    ('fr', 'Venez plutôt chez nous, suivez-nous sur www.autresalon.lb'),
    ('arabizi', 'Order now 3a www.cheap-lb.shop, promo code FREE, dm me.'),
    ('arabizi', 'Follow us 3a www.salon2.lb, as3arna arkhas w a7san.'),
    ('mixed', 'Best deals اطلب الآن www.deals-lb.com use code SALE.'),
    ('mixed', 'Tabe3ouna, promo code BEAUTY, visit www.beauty-lb.link'),
    ('en', 'Earn 500 dollars a day from home, check my page www.easy-money.info'),
    ('en', 'Follow us for giveaways www.giveaway-lb.com, dm us to win.'),
    ('ar', 'ربح سريع من البيت، تواصل معي على t.me/rbeh'),
])

S['threat'] = ('reject', [
    ('en', 'If Karim touches my hair again I will kill you all.'),
    ('en', 'You will regret this, I know where the owner lives.'),
    ('en', 'Watch your back, I will burn your shop down.'),
    ('en', 'I will find the manager and beat you up.'),
    ('ar', 'بقتلك إذا شفتك مرة تانية.'),
    ('ar', 'رح تندم، بعرف وين ساكن صاحب المحل.'),
    ('ar', 'بكسر راسك إذا ما رجعتلي مصرياتي.'),
    ('ar', 'سأقتلك وأحرق المحل.'),
    ('fr', 'Je vais te tuer si tu recommences.'),
    ('fr', 'Tu vas le regretter, je sais où tu habites.'),
    ('arabizi', 'Wallah ba2tlak eza shefak marra tenye.'),
    ('arabizi', 'Ra7 tendam, ba3ref wen sakin.'),
    ('arabizi', 'Bkasserlak rasak eza ma rja3tele masare.'),
    ('mixed', 'I swear بقتلك if you call me again.'),
    ('mixed', 'Ra7 tendam, I will burn your shop.'),
])

S['hate'] = ('reject', [
    ('en', 'Go back to your country, people like you should not work in salons.'),
    ('en', 'Dirty refugees everywhere in this place, disgusting.'),
    ('en', 'They hire foreigners who are all thieves and animals.'),
    ('en', 'Women like her have no brains, should not be allowed to own a business.'),
    ('ar', 'ارجعوا على بلدكم، ما بدنا نازحين بالمحلات.'),
    ('ar', 'نازحين وسخين بكل مكان، مقرف.'),
    ('ar', 'هالطائفة كلها حرامية وما لازم يشتغلوا.'),
    ('fr', 'Retournez dans votre pays, les étrangers sont tous des voleurs.'),
    ('fr', 'Ces gens-là sont des animaux, il faut les virer.'),
    ('arabizi', 'Rja3o 3a baladkon, kellkon 7aramiye.'),
    ('mixed', 'Go back to your country, نازحين وسخين.'),
    ('mixed', 'Kellon 7aramiye, these people are animals.'),
])

S['sexual_harassment'] = ('reject', [
    ('en', 'Rita is so sexy, I only book to look at her body.'),
    ('en', 'Maya send nudes, I will tip extra.'),
    ('en', 'Rita wants to sleep with me, I can tell. Your body is amazing Rita.'),
    ('ar', 'ريتا جسمك حلو، ببعتلك رسالة خاصة.'),
    ('ar', 'مايا مثيرة كتير، بس بروح كرمال شوفها.'),
    ('fr', 'Maya est tellement sexy, je veux coucher avec elle.'),
    ('arabizi', 'Rita sexy ktir, bade nes2ar ma3a.'),
    ('mixed', 'Maya so sexy, جسمك نار.'),
    ('en', 'The girl at reception, Rita, has a hot body, that is the only reason I go.'),
    ('mixed', 'Rita your body is 🔥 send nudes.'),
])

S['insult_person'] = ('manual_review', [
    ('en', 'Karim is an idiot, he has no idea what he is doing.'),
    ('en', 'Rita is a stupid rude bitch, avoid her.'),
    ('en', 'Joe is a moron and a pig, never book with him.'),
    ('en', 'Maya is a loser who should not be cutting hair.'),
    ('en', 'Karim is a donkey, ruined my hair.'),
    ('en', 'Rita is a lazy idiot, talking on the phone the whole time.'),
    ('ar', 'كريم حمار وما بيفهم شي.'),
    ('ar', 'ريتا حقيرة وقليلة أدب.'),
    ('ar', 'جو غبي، خرب شعري.'),
    ('ar', 'مايا تافهة وما لازم تشتغل هون.'),
    ('ar', 'كريم حيوان، ما بعرف يقص.'),
    ('fr', 'Karim est un idiot, il ne sait pas travailler.'),
    ('fr', 'Rita est stupide et malpolie.'),
    ('arabizi', 'Karim 7mar ma bya3ref shi.'),
    ('arabizi', 'Rita ghabe w wese5a.'),
    ('arabizi', 'Joe 7ayawen, 5arrab sha3re.'),
    ('arabizi', 'Maya ta3fe ktir.'),
    ('mixed', 'Karim is a 7mar, خرب شعري.'),
    ('mixed', 'Rita ghabe, stupid and rude.'),
    ('mixed', 'Joe حمار, never again.'),
    ('en', 'Karim is a stupid idiot and his boss is no better.'),
    ('en', 'That idiot Joe cut my ear.'),
    ('ar', 'الموظفة ريتا كلب، ما بتحترم الزبائن.'),
    ('en', 'Maya is a pig, rude to everyone.'),
    ('arabizi', 'Karim kalb, ma byestehel.'),
])

S['unclear'] = ('manual_review', [
    ('en', 'The guy at the desk is an idiot.'),
    ('en', 'She was a stupid cow to me.'),
    ('ar', 'اللي على الاستقبال غبي.'),
    ('en', 'Whoever cut my hair is a moron.'),
    ('arabizi', 'Yalli 3al reception ghabe.'),
    ('fr', 'La fille à l’accueil est une idiote.'),
    ('en', 'The owner is a pig.'),
    ('mixed', 'The guy was a 7mar, bof.'),
    ('ar', 'صاحب المحل حيوان.'),
    ('en', 'Stupid staff, idiot manager.'),
])

# Held out: written after the keyword classifier was tuned on the items above, and never used to
# tune it. Its score is the honest estimate for the heuristic (the tuned set overstates it).
HOLDOUT = [
    ('approve', 'en', 'Friendly barber, decent cut, a bit slow but fine overall.'),
    ('approve', 'en', 'Not my best experience: the wax was too hot and it left red marks for two days.'),
    ('approve', 'ar', 'الشغل مرتب بس الانتظار كان طويل شوي.'),
    ('approve', 'ar', 'ما عجبني اللون أبدًا، ودفعت كتير عليه.'),
    ('approve', 'fr', 'Personnel gentil mais la coupe manquait de précision.'),
    ('approve', 'arabizi', 'Kel shi tamem bas el wa2et kan ta2il shwai.'),
    ('approve', 'mixed', 'Nice place, بس الموسيقى عالية كتير.'),
    ('approve', 'en', 'Maya fixed a colour another salon had ruined. Very grateful.'),
    ('approve', 'fr', 'Cher, mais le résultat en vaut la peine.'),
    ('approve', 'ar', 'جو ساعدني كتير باختيار القصة المناسبة.'),
    ('approve_redacted', 'en', 'Great service, text me 76 987 654 if you want to go together.'),
    ('approve_redacted', 'ar', 'منيح كتير، تواصلوا عبر ٧٨ ٢٢٢ ١١١.'),
    ('approve_redacted', 'fr', 'Très bien, mon mail est sara.test@example.com.'),
    ('approve_redacted', 'mixed', 'Top service, insta @sara_lb_looks.'),
    ('reject', 'en', 'I am going to smash your windows tonight.'),
    ('reject', 'ar', 'رح إكسرلك المحل على راسك.'),
    ('reject', 'en', 'All the migrants working here are filthy criminals.'),
    ('reject', 'fr', 'Les réfugiés sont sales, virez-les tous.'),
    ('reject', 'en', 'Buy cheap perfumes at www.perfume-deals.lb, promo code LB5.'),
    ('reject', 'ar', 'أرخص عطور على www.atour-lb.com، اطلب الآن.'),
    ('reject', 'en', 'Rita has a sexy figure, I want her number.'),
    ('reject', 'arabizi', 'Maya jesma 7elo, badde ra2ma.'),
    ('manual_review', 'en', 'Karim is a clown and a liar.'),
    ('manual_review', 'ar', 'مايا وقحة وكذابة.'),
    ('manual_review', 'fr', 'Joe est un crétin.'),
    ('manual_review', 'arabizi', 'Rita wa2i7a ktir.'),
    ('manual_review', 'en', 'The receptionist is a clueless fool.'),
    ('manual_review', 'mixed', 'Karim is a liar, كذاب.'),
    ('manual_review', 'en', 'Joe is a jerk who laughs at customers.'),
    ('manual_review', 'ar', 'الحلاق كريم نصاب.'),
]

_spec = importlib.util.spec_from_file_location('blind', Path(__file__).with_name('moderation-eval-blind.py'))
_blind = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_blind)

items = []
for i, (expected, lang, text) in enumerate(_blind.BLIND, 1):
    items.append({'id': f'blind-{i:03d}', 'category': 'blind', 'lang': lang, 'expected': expected, 'text': text,
                  'holdout': True})
for i, (expected, lang, text) in enumerate(HOLDOUT, 1):
    items.append({'id': f'holdout-{i:02d}', 'category': 'holdout', 'lang': lang, 'expected': expected, 'text': text,
                  'holdout': True})
for cat, (expected, rows) in S.items():
    for i, (lang, text) in enumerate(rows, 1):
        items.append({'id': f'{cat}-{i:02d}', 'category': cat, 'lang': lang, 'expected': expected, 'text': text})

assert len([i for i in items if not i.get('holdout')]) >= 200, len(items)
assert len([i for i in items if i.get('holdout')]) >= 150, len(items)
assert len({i['text'] for i in items}) == len(items), 'duplicate texts'
out = ROOT / 'packages/edge-tests/eval/moderation-set.json'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({'people': PEOPLE, 'items': items}, ensure_ascii=False, indent=1) + '\n',
               encoding='utf-8', newline='\n')
by = {}
for i in items:
    by[i['lang']] = by.get(i['lang'], 0) + 1
print(len(items), 'items;', by)
