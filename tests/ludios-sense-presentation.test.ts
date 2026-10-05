import { describe, expect, it } from "vitest";
import { groupSenseGames, senseTableGenres } from "@/lib/ludios-sense-presentation";
import type { SenseGame } from "@/lib/ludios-sense-types";
const game = (fields: Partial<SenseGame>) => ({appId:"1",store:"ios",name:"Game",genre:"Games, Entertainment, Games/Casual, Games/Puzzle",...fields} as SenseGame);
describe("Sense table presentation",()=>{
  it("cleans iOS genre labels only for table display",()=>{
    const ios=game({});
    expect(senseTableGenres([ios])).toBe("Casual · Puzzle");
    expect(ios.genre).toBe("Games, Entertainment, Games/Casual, Games/Puzzle");
    expect(senseTableGenres([game({genre:"Game, Game/Board, Game/Card"})])).toBe("Board · Card");
    expect(senseTableGenres([game({store:"android",genre:"Entertainment, Puzzle"})])).toBe("Puzzle");
  });
  it("groups verified unified IDs while preserving independent metrics and ordering",()=>{
    const ios=game({unifiedAppId:"same",evaluation:{latest:4395,growth:4.19} as SenseGame["evaluation"]});
    const other=game({appId:"2",unifiedAppId:"other"});
    const android=game({appId:"pkg",store:"android",name:"Different store title",genre:"Puzzle",unifiedAppId:"same",evaluation:{latest:2507,growth:2.43} as SenseGame["evaluation"]});
    const grouped=groupSenseGames([ios,other,android]);
    expect(grouped).toHaveLength(2);expect(grouped[0].members).toEqual([ios,android]);
    expect(grouped[0].members.map(g=>g.evaluation.latest)).toEqual([4395,2507]);
    expect(senseTableGenres(grouped[0].members)).toBe("Casual · Puzzle");
  });
  it("never groups matching names or unrelated platform IDs without verified mapping",()=>{
    const ios=game({}),android=game({store:"android"});
    expect(groupSenseGames([ios,android])).toHaveLength(2);
    expect(groupSenseGames([ios,android],{"ios:1":"verified","android:1":"verified"})).toHaveLength(1);
    expect(groupSenseGames([ios])).toHaveLength(1);
  });
});

describe("Attention ordering", () => {
 const candidate = (id: string, signal: SenseGame["evaluation"]["signal"], added: number, latest=2000) => game({appId:id,classification:"included",evaluation:{signal,added,latest} as SenseGame["evaluation"]});
 it("prioritizes confirmed signals, early warnings, then holding scale with deterministic ties",async()=>{
  const { sortSenseGroups, senseWorthAttention } = await import("@/lib/ludios-sense-presentation");
  const holding = (id:string,latest:number) => ({...candidate(id,"none",null as unknown as number,latest),watch:{status:"holding_scale"} as SenseGame["watch"]});
  const games=[holding("low",3000),candidate("early","early_warning",9999),candidate("b","confirmed_momentum",100),holding("high",9000),candidate("a","confirmed_momentum",100),candidate("cool","none",500)];
  expect(sortSenseGroups(groupSenseGames(games.filter(senseWorthAttention))).map(group=>group.members[0].appId)).toEqual(["a","b","early","high","low"]);
 });
 it("places a qualifying store first without removing its counterpart",async()=>{
  const { sortSenseGroups } = await import("@/lib/ludios-sense-presentation");
  const ios={...candidate("1","none",0),unifiedAppId:"same"};
  const android={...candidate("pkg","early_warning",1000),unifiedAppId:"same",store:"android" as const};
  expect(sortSenseGroups(groupSenseGames([ios,android]))[0].members).toEqual([android,ios]);
 });
});
