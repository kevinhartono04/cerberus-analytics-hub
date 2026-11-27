import {redirect} from "next/navigation";
import {getCurrentAppUser,isInternalAppUser} from "@/lib/auth";
import SoundStudioClient from "@/components/sound-studio/SoundStudioClient";
export const metadata={title:"Sound Studio | Cerebral"};
export const dynamic="force-dynamic";
export default async function SoundStudioPage(){
 const user=await getCurrentAppUser();
 if(!user)redirect('/sign-in');
 if(!isInternalAppUser(user))return <p>You do not have access to Sound Studio.</p>;
 return <SoundStudioClient user={{id:user.id,name:user.name,email:user.email,role:user.role}}/>;
}
