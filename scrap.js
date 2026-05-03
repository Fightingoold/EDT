const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    console.log("🎬 Scraping Haute Précision : Nettoyage des 'null' et détection NOM PRENOM...");
    
    const browser = await puppeteer.launch({ 
        headless: "new", 
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=fr-FR,fr'] 
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log("🚀 Connexion et navigation...");
        await page.goto('https://planning.univ-lemans.fr/direct/myplanning.jsp', { waitUntil: 'networkidle2' });

        await page.waitForSelector('#username', { timeout: 15000 });
        await page.type('#username', process.env.ADE_USER); 
        await page.type('#password', process.env.ADE_PASS);
        await Promise.all([page.click('#submitBtn'), page.waitForNavigation({ waitUntil: 'networkidle0' })]);

        await new Promise(r => setTimeout(r, 6000));
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
                await new Promise(r => setTimeout(r, 2000));
            } else {
                await handle.click({ clickCount: 2 });
                await new Promise(r => setTimeout(r, 10000));
            }
        }

        const planningData = await page.evaluate(() => {
            const joursSemaine = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
            // Liste des trucs à virer absolument des noms de profs
            const blacklist = ["TD", "TP", "B", "A", "BUT MMI", "MMI1", "TD11", "11B", "TDM", "EP", "SALLE"];

            return Array.from(document.querySelectorAll('.eventText')).map(bloc => {
                const container = bloc.parentElement.parentElement;
                const left = parseInt(container.style.left) || 0;
                
                // On récupère le texte pur du bloc (ce qui est visible entre les <br>)
                // Ça permet d'ignorer les "null" cachés dans les attributs aria-label
                const lignes = bloc.innerText.split('\n').map(s => s.trim()).filter(s => s !== "");

                // 1. HORAIRE
                const texteComplet = bloc.innerText;
                const horaireMatch = texteComplet.match(/\d{2}h\d{2}\s*-\s*\d{2}h\d{2}/);
                const horaire = horaireMatch ? horaireMatch[0].replace(/\s/g, '').replace('-', ' - ') : "N/C";

                // 2. MATIÈRE (Regex pour isoler R2.01 ou SAE2.01)
                let matiere = lignes[0] || "Cours";
                const codeMatiere = matiere.match(/(R\d\.\d+|SA[Eé]\s?\d\.\d+)/i);
                if (codeMatiere) {
                    matiere = codeMatiere[0].toUpperCase().replace('É', 'E').replace(' ', '');
                }

                // 3. SALLE
                const salle = lignes.find(l => l.includes('-MMI') || l.includes('Amphi')) || "N/C";

                // 4. PROF (Logique NOM PRENOM propre)
                let prof = "AUTONOMIE";
                
                // On cherche une ligne qui ressemble à un nom d'humain
                const ligneProf = lignes.find(l => {
                    const lUpper = l.toUpperCase();
                    const mots = l.split(' ').filter(w => w.length > 1);
                    return l !== salle && 
                           !l.includes(matiere) && 
                           !l.includes('h') && // Exclut l'horaire
                           !blacklist.some(b => lUpper.includes(b)) &&
                           mots.length >= 2 && mots.length <= 4 && // Un nom/prénom a 2 à 4 mots
                           !/\d/.test(l); // Pas de chiffres dans un nom
                });

                if (ligneProf) {
                    prof = ligneProf.trim().toUpperCase();
                }

                return {
                    jour: joursSemaine[Math.round(left / 245)] || "Inconnu",
                    matiere, horaire, 
                    type: texteComplet.toUpperCase().includes('TP') ? 'TP' : (texteComplet.toUpperCase().includes('TD') ? 'TD' : 'PROMO'),
                    salle, prof
                };
            }).filter(c => c.horaire !== "N/C");
        });

        fs.writeFileSync('planning.json', JSON.stringify(planningData, null, 2));
        console.log(`✅ Succès ! ${planningData.length} cours extraits.`);

    } catch (error) {
        console.error("❌ ERREUR :", error.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();