# Sources

Generated from the adapters by `npm run docs:sources`. Do not edit by hand.

49 built-in sources. Estate agents are added with one YAML
file each (see `docs/ADAPTERS.md`), and every platform's alert emails are
read from your dedicated mailbox as a second way in.

"Contacts automatically" is the default. Every source can be switched to
watch only, and on platforms whose terms forbid automated access you opt in
per platform with `nlpf sources enable-contact <id>` or in the dashboard.

| Source | Finds listings | Contacts automatically | How |
| --- | --- | --- | --- |
| [123Wonen](https://www.123wonen.nl) | Yes | Yes | Email |
| [Amsterdam Housing](https://www.amsterdamhousing.com) | Yes | Yes | Contact form |
| [Atrium Makelaars](https://www.atrium-makelaars.nl) | Yes | Yes | Email |
| [B&S Rental Service](https://www.bnsrentalservice.nl) | Yes | Yes | Email |
| [Bjornd Makelaardij](https://www.bjornd.nl) | Yes | Yes | Contact form |
| [Carla van den Brink Makelaars](https://www.vandenbrink.nl) | Yes | Yes | Contact form |
| [Deerenberg & Van Leeuwen Makelaars](https://www.deerenberg.nl) | Yes | Yes | Email |
| [Dekkers de Groot Makelaardij](https://www.dekkersdegroot.nl) | Yes | Yes | Email |
| [Directwonen](https://directwonen.nl) | Yes | Watch only | None |
| [Estata Makelaars](https://www.estata.nl) | Yes | Yes | Contact form |
| [Expat & Property Management](https://www.expatpropertymanagement.nl) | Yes | Yes | Contact form |
| [Expat & Real Estate](https://www.expat-realestate.nl) | Yes | Yes | Contact form |
| [Funda](https://www.funda.nl) | Yes | Opt-in | Contact form |
| [Holland2Stay](https://www.holland2stay.com) | Yes | Opt-in | Online booking |
| [HousingAnywhere](https://housinganywhere.com) | Yes | With housinganywhere-plus | Platform message |
| [Huren in Holland Rijnland](https://www.hureninhollandrijnland.nl) | Yes | After you connect | Contact form |
| [Huurstunt](https://www.huurstunt.nl) | Yes | Watch only | None |
| [Huurwoningen](https://www.huurwoningen.nl) | Yes | With huurwoningen-premium | Contact form |
| [Huurzone](https://www.huurzone.nl) | Yes | Watch only | None |
| [Interhouse](https://interhouse.nl) | Yes | Yes | Contact form |
| [Kamer.nl](https://www.kamer.nl) | Yes | With kamernl-premium | Platform message |
| [Kamernet](https://kamernet.nl) | Yes | With kamernet-premium | Platform message |
| [Keij & Stefels](https://www.keij-stefels.nl) | Yes | Yes | Contact form |
| [Lankhuijzen Makelaars](https://www.lankhuijzen.nl) | Yes | Yes | Contact form |
| [Lex van Leeuwen Makelaars](https://www.lexvanleeuwen.nl) | Yes | Yes | Contact form |
| [Marktplaats](https://www.marktplaats.nl) | Yes | Opt-in | Platform message |
| [MVGM (ikwilhuren.nu)](https://ikwilhuren.nu) | Yes | Watch only | None |
| [NederWoon](https://www.nederwoon.nl) | Yes | Watch only | None |
| [Nelisse Makelaarsgroep](https://www.nelisse.nl) | Yes | Yes | Contact form |
| [Pararius](https://www.pararius.nl) | Yes | Opt-in | Contact form |
| [Perfect Rent](https://www.perfectrent.nl) | Yes | Yes | Contact form |
| [Plaza Resident Services](https://plaza.newnewnew.space) | Yes | After you connect | Contact form |
| [Rentola](https://rentola.nl) | Yes | Watch only | None |
| [Residence Makelaars](https://www.residencemakelaars.com) | Yes | Yes | Contact form |
| [RoomMatch (DUWO and other student housing)](https://www.roommatch.nl) | Yes | After you connect | Contact form |
| [Rotsvast](https://www.rotsvast.nl) | Yes | Yes | Email |
| [SSH](https://www.sshxl.nl) | Yes | Watch only | Lottery or waiting list |
| [Stadswonen Rotterdam](https://www.stadswonenrotterdam.nl/nl/aanbod) | Yes | Watch only | None |
| [The House of Expats](https://www.thehouseofexpats.com) | Yes | Yes | Contact form |
| [Van Daal Makelaardij](https://www.vandaalmakelaardij.nl) | Yes | Yes | Email |
| [Van der Linden](https://www.vanderlinden.nl) | Yes | Watch only | None |
| [Van Paaschen Makelaardij](https://www.vanpaaschen.nl) | Yes | Yes | Contact form |
| [Verra Makelaars](https://www.verra.nl) | Yes | Yes | Contact form |
| [Vesteda](https://www.vesteda.com) | Yes | Opt-in | Contact form |
| [WoningNet (DAK)](https://www.woningnet.nl) | Yes | Watch only | None |
| [Woonnet Haaglanden](https://www.woonnet-haaglanden.nl) | Yes | After you connect | Contact form |
| [Woonnet Rijnmond](https://www.woonnetrijnmond.nl) | Yes | After you connect | Contact form |
| [WVO Makelaarsgroep](https://www.wvo.nl) | Yes | Yes | Contact form |
| [Xior](https://www.xiorstudenthousing.eu) | Yes | After you connect | Online booking |

## 123Wonen

Id `wonen123`. https://www.123wonen.nl

| | |
| --- | --- |
| Regions | Alkmaar, Almere, Amersfoort, Amstelveen, Amsterdam, Apeldoorn, Arnhem, Assen, Bergen op zoom, Breda, Capelle aan den ijssel, Delft, Den bosch, 's-hertogenbosch, Den haag, 's-gravenhage, Deventer, Dordrecht, Eindhoven, Emmen, Enschede, Etten-leur, Gouda, Groningen, Haarlem, Haarlemmermeer, Heerlen, Hengelo, Hilversum, Leeuwarden, Leiden, Leidschendam-voorburg, Lelystad, Maastricht, Middelburg, Nieuwegein, Nijmegen, Rijswijk, Roermond, Roosendaal, Rotterdam, Schiedam, Tilburg, Utrecht, Venlo, Vlaardingen, Vlissingen, Woerden, Zaanstad, Zoetermeer, Zwolle |
| Reads listings from | its web pages |
| Checked every | about 600 seconds |
| Contact | Email |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Amsterdam Housing

Id `ogonline:amsterdam-housing`. https://www.amsterdamhousing.com

| | |
| --- | --- |
| Regions | Amsterdam, Amstelveen, Uithoorn, Haarlemmermeer, De ronde venen, Aalsmeer, Purmerend |
| Reads listings from | its JSON API |
| Checked every | about 300 seconds |
| Contact | Contact form |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Atrium Makelaars

Id `ogonline:atrium`. https://www.atrium-makelaars.nl

| | |
| --- | --- |
| Regions | Den haag, Rijswijk, Leidschendam-voorburg, Rotterdam, Teylingen |
| Reads listings from | its JSON API |
| Checked every | about 300 seconds |
| Contact | Email |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## B&S Rental Service

Id `ogonline:bns-rental-service`. https://www.bnsrentalservice.nl

| | |
| --- | --- |
| Regions | Utrecht, Nieuwegein, Houten |
| Reads listings from | its JSON API |
| Checked every | about 300 seconds |
| Contact | Email |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Bjornd Makelaardij

Id `ogonline:bjornd`. https://www.bjornd.nl

| | |
| --- | --- |
| Regions | Delft, Pijnacker-nootdorp, Midden-delfland, Rijswijk |
| Reads listings from | its JSON API |
| Checked every | about 300 seconds |
| Contact | Contact form |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Carla van den Brink Makelaars

Id `ogonline:van-den-brink`. https://www.vandenbrink.nl

| | |
| --- | --- |
| Regions | Amsterdam, Amstelveen |
| Reads listings from | its JSON API |
| Checked every | about 300 seconds |
| Contact | Contact form |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Deerenberg & Van Leeuwen Makelaars

Id `ogonline:deerenberg`. https://www.deerenberg.nl

| | |
| --- | --- |
| Regions | Alphen aan den rijn, Nieuwkoop |
| Reads listings from | its JSON API |
| Checked every | about 300 seconds |
| Contact | Email |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Dekkers de Groot Makelaardij

Id `ogonline:dekkers-de-groot`. https://www.dekkersdegroot.nl

| | |
| --- | --- |
| Regions | Den haag |
| Reads listings from | its JSON API |
| Checked every | about 300 seconds |
| Contact | Email |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Directwonen

Id `directwonen`. https://directwonen.nl

| | |
| --- | --- |
| Regions | The whole country |
| Reads listings from | its web pages |
| Checked every | about 900 seconds |
| Contact | None |
| Login | required |
| Paid plan to react | directwonen-premium |
| Terms on automation | unknown |
| Default | Watch only: reacting needs a paid plan (directwonen-premium); without it the agent looks for a free copy of the same home; it needs one login with nlpf connect |

## Estata Makelaars

Id `ogonline:estata`. https://www.estata.nl

| | |
| --- | --- |
| Regions | Den haag, Wassenaar, Rijswijk, Leidschendam-voorburg, Westland, Zoetermeer |
| Reads listings from | its JSON API |
| Checked every | about 300 seconds |
| Contact | Contact form |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Expat & Property Management

Id `ogonline:expat-property-management`. https://www.expatpropertymanagement.nl

| | |
| --- | --- |
| Regions | Den haag, Rijswijk, Leiden, Zoetermeer, Westland |
| Reads listings from | its JSON API |
| Checked every | about 300 seconds |
| Contact | Contact form |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Expat & Real Estate

Id `ogonline:expat-real-estate`. https://www.expat-realestate.nl

| | |
| --- | --- |
| Regions | Den haag, Leidschendam-voorburg, Delft, Rijswijk, Pijnacker-nootdorp, Wassenaar, Voorschoten, Westland |
| Reads listings from | its JSON API |
| Checked every | about 600 seconds |
| Contact | Contact form |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Funda

Id `funda`. https://www.funda.nl

| | |
| --- | --- |
| Regions | The whole country |
| Reads listings from | its web pages |
| Checked every | about 90 seconds |
| Contact | Contact form |
| Login | none |
| Paid plan to react | no |
| Terms on automation | forbids |
| Default | Opt-in: its terms forbid automated access, so contact waits for your opt-in |

## Holland2Stay

Id `holland2stay`. https://www.holland2stay.com

| | |
| --- | --- |
| Regions | The whole country |
| Reads listings from | a real browser |
| Checked every | about 120 seconds |
| Contact | Online booking |
| Login | required |
| Paid plan to react | no |
| Terms on automation | forbids |
| Default | Opt-in: its terms forbid automated access, so contact waits for your opt-in; it needs one login with nlpf connect; it is read in a real browser on a private display; homes are booked first come, first served |

## HousingAnywhere

Id `housinganywhere`. https://housinganywhere.com

| | |
| --- | --- |
| Regions | The whole country |
| Reads listings from | its JSON API |
| Checked every | about 60 seconds |
| Contact | Platform message |
| Login | required |
| Paid plan to react | housinganywhere-plus |
| Terms on automation | forbids |
| Default | With housinganywhere-plus: its terms forbid automated access, so contact waits for your opt-in; reacting needs a paid plan (housinganywhere-plus); without it the agent looks for a free copy of the same home; it needs one login with nlpf connect |

## Huren in Holland Rijnland

Id `holland-rijnland`. https://www.hureninhollandrijnland.nl

| | |
| --- | --- |
| Regions | Leiden, Leiderdorp, Oegstgeest, Voorschoten, Zoeterwoude, Katwijk, Noordwijk, Teylingen, Lisse, Hillegom, Alphen aan den rijn, Kaag en braassem, Nieuwkoop |
| Reads listings from | its JSON API |
| Checked every | about 300 seconds |
| Contact | Contact form |
| Login | required |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | After you connect: it needs one login with nlpf connect |

## Huurstunt

Id `huurstunt`. https://www.huurstunt.nl

| | |
| --- | --- |
| Regions | The whole country |
| Reads listings from | its web pages |
| Checked every | about 900 seconds |
| Contact | None |
| Login | required |
| Paid plan to react | huurstunt-premium |
| Terms on automation | unknown |
| Default | Watch only: reacting needs a paid plan (huurstunt-premium); without it the agent looks for a free copy of the same home; it needs one login with nlpf connect |

## Huurwoningen

Id `huurwoningen`. https://www.huurwoningen.nl

| | |
| --- | --- |
| Regions | The whole country |
| Reads listings from | a real browser |
| Checked every | about 300 seconds |
| Contact | Contact form |
| Login | required |
| Paid plan to react | huurwoningen-premium |
| Terms on automation | forbids |
| Default | With huurwoningen-premium: its terms forbid automated access, so contact waits for your opt-in; reacting needs a paid plan (huurwoningen-premium); without it the agent looks for a free copy of the same home; it needs one login with nlpf connect; it is read in a real browser on a private display |

## Huurzone

Id `huurzone`. https://www.huurzone.nl

| | |
| --- | --- |
| Regions | The whole country |
| Reads listings from | its web pages |
| Checked every | about 900 seconds |
| Contact | None |
| Login | required |
| Paid plan to react | huurzone-premium |
| Terms on automation | unknown |
| Default | Watch only: reacting needs a paid plan (huurzone-premium); without it the agent looks for a free copy of the same home; it needs one login with nlpf connect |

## Interhouse

Id `interhouse`. https://interhouse.nl

| | |
| --- | --- |
| Regions | Almere, Amersfoort, Amstelveen, Amsterdam, Breda, De bilt, Delft, Den haag, 's-gravenhage, Diemen, Eindhoven, Gooise meren, Haarlem, Haarlemmermeer, Heemstede, Hilversum, Huizen, Leiden, Leidschendam-voorburg, Nieuwegein, Oegstgeest, Rijswijk, Rotterdam, Teylingen, Utrecht, Wassenaar, Zeist, Zoetermeer |
| Reads listings from | its web pages |
| Checked every | about 180 seconds |
| Contact | Contact form |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Kamer.nl

Id `kamernl`. https://www.kamer.nl

| | |
| --- | --- |
| Regions | The whole country |
| Reads listings from | a real browser |
| Checked every | about 900 seconds |
| Contact | Platform message |
| Login | required |
| Paid plan to react | kamernl-premium |
| Terms on automation | unknown |
| Default | With kamernl-premium: reacting needs a paid plan (kamernl-premium); without it the agent looks for a free copy of the same home; it needs one login with nlpf connect; it is read in a real browser on a private display |

## Kamernet

Id `kamernet`. https://kamernet.nl

| | |
| --- | --- |
| Regions | The whole country |
| Reads listings from | its JSON API |
| Checked every | about 60 seconds |
| Contact | Platform message |
| Login | required |
| Paid plan to react | kamernet-premium |
| Terms on automation | forbids |
| Default | With kamernet-premium: its terms forbid automated access, so contact waits for your opt-in; reacting needs a paid plan (kamernet-premium); without it the agent looks for a free copy of the same home; it needs one login with nlpf connect; contacting runs in a real browser on a private display |

## Keij & Stefels

Id `ogonline:keij-stefels`. https://www.keij-stefels.nl

| | |
| --- | --- |
| Regions | Amsterdam, Amstelveen, Diemen, Ouder-amstel, Almere, Utrecht |
| Reads listings from | its JSON API |
| Checked every | about 600 seconds |
| Contact | Contact form |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Lankhuijzen Makelaars

Id `ogonline:lankhuijzen`. https://www.lankhuijzen.nl

| | |
| --- | --- |
| Regions | Rotterdam, Schiedam, Barendrecht |
| Reads listings from | its JSON API |
| Checked every | about 300 seconds |
| Contact | Contact form |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Lex van Leeuwen Makelaars

Id `ogonline:lex-van-leeuwen`. https://www.lexvanleeuwen.nl

| | |
| --- | --- |
| Regions | Den haag |
| Reads listings from | its JSON API |
| Checked every | about 300 seconds |
| Contact | Contact form |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Marktplaats

Id `marktplaats`. https://www.marktplaats.nl

| | |
| --- | --- |
| Regions | The whole country |
| Reads listings from | its JSON API |
| Checked every | about 60 seconds |
| Contact | Platform message |
| Login | required |
| Paid plan to react | no |
| Terms on automation | forbids |
| Default | Opt-in: its terms forbid automated access, so contact waits for your opt-in; it needs one login with nlpf connect |

## MVGM (ikwilhuren.nu)

Id `mvgm`. https://ikwilhuren.nu

| | |
| --- | --- |
| Regions | The whole country |
| Reads listings from | its web pages |
| Checked every | about 300 seconds |
| Contact | None |
| Login | required |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Watch only: it needs one login with nlpf connect |

## NederWoon

Id `nederwoon`. https://www.nederwoon.nl

| | |
| --- | --- |
| Regions | Almere, Amersfoort, Amsterdam, Apeldoorn, Arnhem, Breda, Delft, Den bosch, 's-hertogenbosch, Den haag, 's-gravenhage, Deventer, Ede, Eindhoven, Enschede, Groningen, Haarlem, Houten, Leeuwarden, Leiden, Maastricht, Nieuwegein, Nijmegen, Rotterdam, Tilburg, Utrecht, Veenendaal, Wageningen, Zeist, Zwolle |
| Reads listings from | its web pages |
| Checked every | about 900 seconds |
| Contact | None |
| Login | required |
| Paid plan to react | nederwoon-account |
| Terms on automation | unknown |
| Default | Watch only: reacting needs a paid plan (nederwoon-account); without it the agent looks for a free copy of the same home; it needs one login with nlpf connect |

## Nelisse Makelaarsgroep

Id `ogonline:nelisse`. https://www.nelisse.nl

| | |
| --- | --- |
| Regions | Den haag, Rijswijk |
| Reads listings from | its JSON API |
| Checked every | about 900 seconds |
| Contact | Contact form |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Pararius

Id `pararius`. https://www.pararius.nl

| | |
| --- | --- |
| Regions | The whole country |
| Reads listings from | a real browser |
| Checked every | about 180 seconds |
| Contact | Contact form |
| Login | required |
| Paid plan to react | no |
| Terms on automation | forbids |
| Default | Opt-in: its terms forbid automated access, so contact waits for your opt-in; it needs one login with nlpf connect; it is read in a real browser on a private display |

## Perfect Rent

Id `ogonline:perfect-rent`. https://www.perfectrent.nl

| | |
| --- | --- |
| Regions | Rotterdam |
| Reads listings from | its JSON API |
| Checked every | about 300 seconds |
| Contact | Contact form |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Plaza Resident Services

Id `plaza`. https://plaza.newnewnew.space

| | |
| --- | --- |
| Regions | Utrecht, Delft, Rijswijk, Amsterdam, Ouder-amstel, Breda, Geldrop-mierlo, Eindhoven, Maastricht, Enschede, Deventer |
| Reads listings from | its JSON API |
| Checked every | about 60 seconds |
| Contact | Contact form |
| Login | required |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | After you connect: it needs one login with nlpf connect |

## Rentola

Id `rentola`. https://rentola.nl

| | |
| --- | --- |
| Regions | The whole country |
| Reads listings from | its web pages |
| Checked every | about 900 seconds |
| Contact | None |
| Login | required |
| Paid plan to react | rentola-premium |
| Terms on automation | unknown |
| Default | Watch only: reacting needs a paid plan (rentola-premium); without it the agent looks for a free copy of the same home; it needs one login with nlpf connect |

## Residence Makelaars

Id `ogonline:residence`. https://www.residencemakelaars.com

| | |
| --- | --- |
| Regions | Den haag, Leidschendam-voorburg, Wassenaar, Rijswijk |
| Reads listings from | its JSON API |
| Checked every | about 300 seconds |
| Contact | Contact form |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## RoomMatch (DUWO and other student housing)

Id `roommatch`. https://www.roommatch.nl

| | |
| --- | --- |
| Regions | Delft, Den haag, Leiden, Amsterdam, Amstelveen, Haarlemmermeer, Haarlem, Wageningen, Groningen, Deventer |
| Reads listings from | its JSON API |
| Checked every | about 60 seconds |
| Contact | Contact form |
| Login | required |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | After you connect: it needs one login with nlpf connect |

## Rotsvast

Id `rotsvast`. https://www.rotsvast.nl

| | |
| --- | --- |
| Regions | Alphen aan den rijn, Amersfoort, Amstelveen, Amsterdam, Bergen op zoom, Breda, Delft, Den bosch, 's-hertogenbosch, Den haag, 's-gravenhage, Dordrecht, Eindhoven, Gouda, Groningen, Haarlem, Hilversum, Leeuwarden, Leiden, Leidschendam-voorburg, Maastricht, Middelburg, Nijmegen, Purmerend, Rijswijk, Roermond, Rotterdam, Schiedam, Tilburg, Utrecht, Zoetermeer |
| Reads listings from | its web pages |
| Checked every | about 600 seconds |
| Contact | Email |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## SSH

Id `ssh`. https://www.sshxl.nl

| | |
| --- | --- |
| Regions | The whole country |
| Reads listings from | its JSON API |
| Checked every | about 60 seconds |
| Contact | Lottery or waiting list |
| Login | required |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Watch only: it needs one login with nlpf connect |

## Stadswonen Rotterdam

Id `stadswonen`. https://www.stadswonenrotterdam.nl/nl/aanbod

| | |
| --- | --- |
| Regions | Rotterdam |
| Reads listings from | its JSON API |
| Checked every | about 600 seconds |
| Contact | None |
| Login | required |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Watch only: it needs one login with nlpf connect |

## The House of Expats

Id `ogonline:the-house-of-expats`. https://www.thehouseofexpats.com

| | |
| --- | --- |
| Regions | Den haag, Westland |
| Reads listings from | its JSON API |
| Checked every | about 300 seconds |
| Contact | Contact form |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Van Daal Makelaardij

Id `ogonline:van-daal`. https://www.vandaalmakelaardij.nl

| | |
| --- | --- |
| Regions | Delft, Rijswijk, Den haag, Midden-delfland, Zoeterwoude, Rotterdam |
| Reads listings from | its JSON API |
| Checked every | about 300 seconds |
| Contact | Email |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Van der Linden

Id `vanderlinden`. https://www.vanderlinden.nl

| | |
| --- | --- |
| Regions | Aalsmeer, Alkmaar, Almere, Amersfoort, Amstelveen, Amsterdam, Apeldoorn, Beverwijk, Bunnik, De bilt, Diemen, Dijk en waard, Dronten, Elburg, Epe, Gooise meren, Haarlem, Haarlemmermeer, Harderwijk, Heerde, Hilversum, Huizen, Kampen, Laren, Lelystad, Nunspeet, Oldebroek, Oudewater, Putten, Stichtse vecht, Utrecht, Utrechtse heuvelrug, Vijfheerenlanden, Waalwijk, Wijdemeren, Woerden, Zaanstad, Zaltbommel, Zeewolde, Zeist |
| Reads listings from | its web pages |
| Checked every | about 600 seconds |
| Contact | None |
| Login | optional |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Watch only: nothing special |

## Van Paaschen Makelaardij

Id `ogonline:van-paaschen`. https://www.vanpaaschen.nl

| | |
| --- | --- |
| Regions | Den haag, Leidschendam-voorburg, Rijswijk, Wassenaar |
| Reads listings from | its JSON API |
| Checked every | about 300 seconds |
| Contact | Contact form |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Verra Makelaars

Id `ogonline:verra`. https://www.verra.nl

| | |
| --- | --- |
| Regions | Den haag, Rotterdam, Delft, Leiden, Rijswijk, Leidschendam-voorburg, Wassenaar, Voorschoten, Oegstgeest, Noordwijk, Albrandswaard, Barendrecht, Capelle aan den ijssel, Nissewaard, Lansingerland, Maassluis, Utrecht |
| Reads listings from | its JSON API |
| Checked every | about 300 seconds |
| Contact | Contact form |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Vesteda

Id `vesteda`. https://www.vesteda.com

| | |
| --- | --- |
| Regions | The whole country |
| Reads listings from | its JSON API |
| Checked every | about 60 seconds |
| Contact | Contact form |
| Login | required |
| Paid plan to react | no |
| Terms on automation | forbids |
| Default | Opt-in: its terms forbid automated access, so contact waits for your opt-in; it needs one login with nlpf connect |

## WoningNet (DAK)

Id `woningnet-dak`. https://www.woningnet.nl

| | |
| --- | --- |
| Regions | Amsterdam, Aalsmeer, Amstelveen, Diemen, Edam-volendam, Haarlemmermeer, Landsmeer, Oostzaan, Ouder-amstel, Purmerend, Uithoorn, Waterland, Wormerland, Zaanstad, Utrecht, Bunnik, De bilt, Houten, Ijsselstein, Lopik, Montfoort, Nieuwegein, Oudewater, Stichtse vecht, Utrechtse heuvelrug, Vijfheerenlanden, Wijk bij duurstede, Woerden, Zeist, Almere, Gouda, Bodegraven-reeuwijk, Krimpenerwaard, Waddinxveen, Zuidplas, Hilversum, Huizen, Gooise meren, Blaricum, Laren, Wijdemeren, Eemnes, Amersfoort, Baarn, Bunschoten, Leusden, Soest, Woudenberg, Groningen |
| Reads listings from | a real browser |
| Checked every | about 1800 seconds |
| Contact | None |
| Login | required |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Watch only: it needs one login with nlpf connect |

## Woonnet Haaglanden

Id `woonnet-haaglanden`. https://www.woonnet-haaglanden.nl

| | |
| --- | --- |
| Regions | Den haag, Delft, Zoetermeer, Rijswijk, Leidschendam-voorburg, Pijnacker-nootdorp, Westland, Wassenaar, Midden-delfland |
| Reads listings from | its JSON API |
| Checked every | about 60 seconds |
| Contact | Contact form |
| Login | required |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | After you connect: it needs one login with nlpf connect |

## Woonnet Rijnmond

Id `woonnet-rijnmond`. https://www.woonnetrijnmond.nl

| | |
| --- | --- |
| Regions | Rotterdam, Schiedam, Vlaardingen, Maassluis, Capelle aan den ijssel, Krimpen aan den ijssel, Barendrecht, Ridderkerk, Albrandswaard, Nissewaard, Voorne aan zee, Lansingerland |
| Reads listings from | its JSON API |
| Checked every | about 300 seconds |
| Contact | Contact form |
| Login | required |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | After you connect: it needs one login with nlpf connect |

## WVO Makelaarsgroep

Id `ogonline:wvo`. https://www.wvo.nl

| | |
| --- | --- |
| Regions | Utrecht, Nieuwegein, Zeist, De bilt, Hilversum |
| Reads listings from | its JSON API |
| Checked every | about 300 seconds |
| Contact | Contact form |
| Login | none |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | Yes: nothing special |

## Xior

Id `xior`. https://www.xiorstudenthousing.eu

| | |
| --- | --- |
| Regions | Amsterdam, Breda, Delft, Eindhoven, Enschede, Groningen, Leeuwarden, Maastricht, Den haag, 's-gravenhage, Utrecht, Venlo, Wageningen |
| Reads listings from | a real browser |
| Checked every | about 1800 seconds |
| Contact | Online booking |
| Login | required |
| Paid plan to react | no |
| Terms on automation | unknown |
| Default | After you connect: it needs one login with nlpf connect; it is read in a real browser on a private display; homes are booked first come, first served |
