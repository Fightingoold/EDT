const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    console.log("🎬 Scraping Haute Précision : Matières & Profs épurés...");
    
    const browser = await puppeteer.launch({ 
        headless: "new", 
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=fr-FR,fr'] 
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("🚀 Connexion...");
        await page.goto('https://planning.univ-lemans.fr/direct/myplanning.jsp', { waitUntil: 'networkidle2' });

        await page.waitForSelector('#username', { timeout: 15000 });
        await page.type('#username', process.env.ADE_USER); 
        await page.type('#password', process.env.ADE_PASS);
        await Promise.all([
            page.click('#submitBtn'),
            page.waitForNavigation({ waitUntil: 'networkidle0' })
        ]);

        await new Promise(r => setTimeout(r, 5000));
        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button, span, a')).find(el => 
                ["PROCEED", "CONTINUER", "CONTINUE"].some(l => el.innerText.toUpperCase().includes(l))
            );
            if (btn) btn.click();
        });

        await new Promise(r => setTimeout(r, 8000)); 

        const etapes = [["Etudiants", "Trainees"], ["IUT LAVAL", "IUT LAVAL"], ["Dpt MMI", "Dpt MMI"], ["BUT MMI1", "BUT MMI1"], ["TD11", "TD11"], ["11B", "11B"]];
        
        for (const [fr, en] of etapes) {
            await page.waitForFunction((f, e) => {
                const spans = Array.from(document.querySelectorAll('span'));
                return spans.some(s => (s.innerText.trim() === f || s.innerText.trim() === e) && s.offsetHeight > 0);
            }, { timeout: 20000 }, fr, en);

            const handle = await page.evaluateHandle((f, e) => {
                return Array.from(document.querySelectorAll('span')).find(s => s.innerText.trim() === f || s.innerText.trim() === e);
            }, fr, en);

            if (fr !== "11B") {
                await page.evaluate((f, e) => {
                    const span = Array.from(document.querySelectorAll('span')).find(s => s.innerText.trim() === f || s.innerText.trim() === e);
                    const icon = span?.parentElement?.querySelector('.x-tree3-node-joint');
                    if (icon) icon.click();
                }, fr, en);
                await new Promise(r => setTimeout(r, 2500));
            } else {
                await handle.click({ clickCount: 2 });
                await new Promise(r => setTimeout(r, 10000));
            }
        }

        const planningData = await page.evaluate(() => {
            const joursSemaine = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
            return Array.from(document.querySelectorAll('.eventText')).map(bloc => {
                const container = bloc.parentElement.parentElement;
                const left = parseInt(container.style.left) || 0;
                const texteBrut = bloc.innerText.trim();
                const lignes = texteBrut.split('\n').map(s => s.trim()).filter(s => s !== "");
                
                // 1. MATIÈRE : On ne garde que le code (R.XXX ou SAE.XXX)
                let matiere = lignes[0] || "Cours";
                const codeMatch = matiere.match(/(R\d\.\d+|SAE\d\.\d+)/i);
                if (codeMatch) matiere = codeMatch[0].toUpperCase();

                // 2. HORAIRE
                const horaireMatch = texteBrut.match(/\d{2}h\d{2}\s*-\s*\d{2}h\d{2}/);
                const horaire = horaireMatch ? horaireMatch[0].replace(/\s/g, '').replace('-', ' - ') : "N/C";
                
                // 3. TYPE
                let type = "PROMO";
                if (texteBrut.toUpperCase().includes('TP')) type = "TP";
                else if (texteBrut.toUpperCase().includes('TD')) type = "TD";

                // 4. SALLE
                const salle = lignes.find(l => l.includes('-MMI') || l.includes('Amphi') || l.includes('Salles')) || "N/C";

                // 5. PROF : On épure pour ne garder que le Nom de famille
                let profRaw = "N/C";
                if (lignes.length >= 3) {
                    const derniere = lignes[lignes.length - 1];
                    const avantDerniere = lignes[lignes.length - 2];
                    profRaw = (derniere === salle) ? avantDerniere : derniere;
                }
                // Regex pour garder seulement les mots en majuscules (Nom) et ignorer les prénoms ou bruits
                let prof = profRaw.split(' ').filter(word => word === word.toUpperCase() && word.length > 1).join(' ');
                if (!prof) prof = profRaw; // Fallback si pas de majuscules

                return {
                    jour: joursSemaine[Math.round(left / 245)] || "Inconnu",
                    matiere, horaire, type, salle, prof
                };
            }).filter(c => c.horaire !== "N/C");
        });

        fs.writeFileSync('planning.json', JSON.stringify(planningData, null, 2));
        console.log(`✅ Extraction épurée terminée.`);

    } catch (error) {
        console.error("❌ ERREUR :", error.message);
        await page.screenshot({ path: 'error.png' });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();