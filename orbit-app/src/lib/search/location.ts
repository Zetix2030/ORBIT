export type LocationIntent = {
  city?: string;
  country?: string;
  currency?: string;
};

const COUNTRY_ALIASES: Array<{country:string; currency:string; aliases:string[]}> = [
  {country:"United States",currency:"USD",aliases:["usa","u.s.a","us","u.s.","united states","united states of america","etats-unis","états-unis","etats unis","états unis","amerique","amérique"]},
  {country:"France",currency:"EUR",aliases:["france"]},
  {country:"United Kingdom",currency:"GBP",aliases:["uk","u.k.","united kingdom","royaume-uni","royaume uni","england","angleterre","scotland","wales"]},
  {country:"Canada",currency:"CAD",aliases:["canada"]},
  {country:"Germany",currency:"EUR",aliases:["germany","allemagne","deutschland"]},
  {country:"Spain",currency:"EUR",aliases:["spain","espagne","espana","españa"]},
  {country:"Portugal",currency:"EUR",aliases:["portugal"]},
  {country:"Italy",currency:"EUR",aliases:["italy","italie","italia"]},
  {country:"Belgium",currency:"EUR",aliases:["belgium","belgique","belgie","belgië"]},
  {country:"Netherlands",currency:"EUR",aliases:["netherlands","pays-bas","pays bas","nederland"]},
  {country:"Switzerland",currency:"CHF",aliases:["switzerland","suisse","schweiz","svizzera"]},
  {country:"Austria",currency:"EUR",aliases:["austria","autriche","osterreich","österreich"]},
  {country:"Ireland",currency:"EUR",aliases:["ireland","irlande"]},
  {country:"Australia",currency:"AUD",aliases:["australia","australie"]},
  {country:"New Zealand",currency:"NZD",aliases:["new zealand","nouvelle-zelande","nouvelle zélande"]},
  {country:"Mexico",currency:"MXN",aliases:["mexico","mexique"]},
  {country:"Brazil",currency:"BRL",aliases:["brazil","bresil","brésil","brasil"]},
  {country:"Argentina",currency:"ARS",aliases:["argentina","argentine"]},
  {country:"Chile",currency:"CLP",aliases:["chile","chili"]},
  {country:"Colombia",currency:"COP",aliases:["colombia","colombie"]},
  {country:"United Arab Emirates",currency:"AED",aliases:["uae","united arab emirates","emirats arabes unis","émirats arabes unis","dubai"]},
  {country:"Saudi Arabia",currency:"SAR",aliases:["saudi arabia","arabie saoudite"]},
  {country:"Morocco",currency:"MAD",aliases:["morocco","maroc"]},
  {country:"Algeria",currency:"DZD",aliases:["algeria","algerie","algérie"]},
  {country:"Tunisia",currency:"TND",aliases:["tunisia","tunisie"]},
  {country:"South Africa",currency:"ZAR",aliases:["south africa","afrique du sud"]},
  {country:"Turkey",currency:"TRY",aliases:["turkey","turquie","turkiye","türkiye"]},
  {country:"Greece",currency:"EUR",aliases:["greece","grece","grèce"]},
  {country:"Poland",currency:"PLN",aliases:["poland","pologne","polska"]},
  {country:"Czechia",currency:"CZK",aliases:["czechia","czech republic","republique tcheque","république tchèque"]},
  {country:"Japan",currency:"JPY",aliases:["japan","japon"]},
  {country:"South Korea",currency:"KRW",aliases:["south korea","coree du sud","corée du sud","korea"]},
  {country:"China",currency:"CNY",aliases:["china","chine"]},
  {country:"India",currency:"INR",aliases:["india","inde"]},
  {country:"Thailand",currency:"THB",aliases:["thailand","thailande","thaïlande"]},
  {country:"Singapore",currency:"SGD",aliases:["singapore","singapour"]},
];

const CITY_COUNTRY: Record<string, LocationIntent> = {
  "miami":{city:"Miami",country:"United States",currency:"USD"},
  "new york":{city:"New York",country:"United States",currency:"USD"},
  "los angeles":{city:"Los Angeles",country:"United States",currency:"USD"},
  "washington":{city:"Washington",country:"United States",currency:"USD"},
  "london":{city:"London",country:"United Kingdom",currency:"GBP"},
  "londres":{city:"London",country:"United Kingdom",currency:"GBP"},
  "paris":{city:"Paris",country:"France",currency:"EUR"},
  "brest":{city:"Brest",country:"France",currency:"EUR"},
  "lyon":{city:"Lyon",country:"France",currency:"EUR"},
  "marseille":{city:"Marseille",country:"France",currency:"EUR"},
  "berlin":{city:"Berlin",country:"Germany",currency:"EUR"},
  "madrid":{city:"Madrid",country:"Spain",currency:"EUR"},
  "barcelona":{city:"Barcelona",country:"Spain",currency:"EUR"},
  "lisbon":{city:"Lisbon",country:"Portugal",currency:"EUR"},
  "lisbonne":{city:"Lisbon",country:"Portugal",currency:"EUR"},
  "rome":{city:"Rome",country:"Italy",currency:"EUR"},
  "milan":{city:"Milan",country:"Italy",currency:"EUR"},
  "dubai":{city:"Dubai",country:"United Arab Emirates",currency:"AED"},
  "tokyo":{city:"Tokyo",country:"Japan",currency:"JPY"},
  "sydney":{city:"Sydney",country:"Australia",currency:"AUD"},
  "toronto":{city:"Toronto",country:"Canada",currency:"CAD"},
  "montreal":{city:"Montreal",country:"Canada",currency:"CAD"},
};

function norm(value:string){return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[’']/g,"'").trim();}

export function detectLocationDeterministically(query:string): LocationIntent {
  const q=norm(query);
  let result:LocationIntent={};
  for(const [key,value] of Object.entries(CITY_COUNTRY)){
    if(q.includes(norm(key))){ result={...value}; break; }
  }
  for(const entry of COUNTRY_ALIASES){
    if(entry.aliases.some(alias=>new RegExp(`(^|\\W)${norm(alias).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?=\\W|$)`,"i").test(q))){
      result.country=entry.country; result.currency=entry.currency; break;
    }
  }
  return result;
}

export async function detectLocationWithAI(query:string, apiKey?:string):Promise<LocationIntent>{
  const fallback=detectLocationDeterministically(query);
  if(!apiKey) return fallback;
  try{
    const response=await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},
      body:JSON.stringify({
        model:"gpt-4o-mini",
        temperature:0,
        response_format:{type:"json_object"},
        messages:[
          {role:"system",content:"Extract real-estate location from the user's query. Return JSON only with city, country (English canonical country name), currency (ISO 4217). Never assume France just because the query is French. If a country is explicit, respect it. If a city clearly implies a country (Miami=United States, London=United Kingdom), infer it. Omit unknown fields."},
          {role:"user",content:query}
        ]
      }),
    });
    if(!response.ok) return fallback;
    const payload=await response.json() as {choices?:Array<{message?:{content?:string}}>};
    const content=payload.choices?.[0]?.message?.content;
    if(!content) return fallback;
    const parsed=JSON.parse(content) as LocationIntent;
    return {
      city: typeof parsed.city==="string"&&parsed.city.trim()?parsed.city.trim():fallback.city,
      country: typeof parsed.country==="string"&&parsed.country.trim()?parsed.country.trim():fallback.country,
      currency: typeof parsed.currency==="string"&&/^[A-Z]{3}$/.test(parsed.currency)?parsed.currency:fallback.currency,
    };
  }catch{return fallback;}
}
