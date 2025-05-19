import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const RIOT_API_KEY = process.env.RIOT_API_KEY;

const headers = {
  'X-Riot-Token': RIOT_API_KEY,
};

export async function fetchAndStorePuuid(name: string, tagline: string) {
  try {
    const url = "https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/" + name + "/" + tagline;
    const response = await axios.get(url, { headers });
    const puuid = response.data.puuid;

    return puuid;
  } catch (error) {
    console.error('Error fetching or storing PUUID:', error);
    throw error;
  }
}